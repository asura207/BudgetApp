import { NativeModules, Platform } from 'react-native';
import dayjs from 'dayjs';
import {
  getNickname,
  setNickname,
  getNicknameCreatedAt,
  setNicknameCreatedAt,
  getMonthlyBudget,
  setMonthlyBudget,
  getViewMode,
  setViewMode,
  getManualInstallment,
  setManualInstallment,
} from '../storage/mmkv';
import { transactionDao } from '../database/transactionDao';
import { recurringDao } from '../database/recurringDao';
import { holidayDao } from '../database/holidayDao';
import { parseExceptionDao } from '../database/parseExceptionDao';
import { appNotificationDao, AppNotificationRaw } from '../database/appNotificationDao';
import { Transaction, RecurringRule, Holiday } from '../types/budget';
import { safeDbExecute } from '../database/db';
import CryptoJS from 'crypto-js';

const { SmsHistoryParserModule } = NativeModules;
const BUGET_API_KEY = 'bgk_8LrxkgUuYJqGAnM3EXOkgBVif76aJ3ZUD6dM6QYJSCo';
const BUGET_HMAC_SECRET = 'buget123$%^';
const API_BASE_URL = 'http://218.234.55.78:8000';

/**
 * 16바이트(32자리 hex) 고유 Nonce 생성
 */
const generateHexNonce32 = (): string => {
  const bytes = new Uint8Array(16);
  const cryptoObj = (globalThis as any)?.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * strict 모드 (API Key + HMAC-SHA256) 인증 헤더 생성
 */
const buildStrictAuthHeaders = (
  method: 'GET' | 'POST',
  pathWithQuery: string,
  rawBodyString: string = ''
): Record<string, string> => {
  const timestampStr = Math.floor(Date.now() / 1000).toString();
  const nonceStr = generateHexNonce32();
  const sha256Hex = CryptoJS.SHA256(rawBodyString).toString(CryptoJS.enc.Hex).toLowerCase();
  const messageToSign = `${method}\n${pathWithQuery}\n${timestampStr}\n${nonceStr}\n${sha256Hex}`;
  const signature = CryptoJS.HmacSHA256(messageToSign, BUGET_HMAC_SECRET)
    .toString(CryptoJS.enc.Hex)
    .toLowerCase();

  return {
    'X-API-Key': BUGET_API_KEY,
    'X-Timestamp': timestampStr,
    'X-Nonce': nonceStr,
    'X-Signature': signature,
  };
};

/**
 * 원격 DB HTTP 요청 타임아웃 래퍼 (기본 10초)
 */
const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs: number = 10000
): Promise<Response> => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timerId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, {
      ...options,
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error('원격 서버 응답 시간이 초과되었습니다.');
    }
    throw e;
  } finally {
    if (timerId !== null) clearTimeout(timerId);
  }
};

export interface BudgetAppBackupData {
  version: number;
  exportedAt: string;
  user: {
    nickname: string | null;
    nicknameCreatedAt: string;
    monthlyBudget: number;
    viewMode: string;
    userKey?: string;
  };
  transactions: Transaction[];
  recurringRules: RecurringRule[];
  customHolidays: Holiday[];
  parseExceptions: { keyword: string; applyPush: boolean; applySms: boolean }[];
  manualInstallments: { [yearMonth: string]: number };
  rawAppNotifications?: AppNotificationRaw[];
}

export const backupService = {
  generateBackupJson(): string {
    const nickname = getNickname();
    const nicknameCreatedAt = getNicknameCreatedAt();
    const monthlyBudget = getMonthlyBudget();
    const viewMode = getViewMode();

    const currentYearNum = dayjs().year();
    const allYears = [currentYearNum - 2, currentYearNum - 1, currentYearNum, currentYearNum + 1];
    const allTransactionsMap = new Map<string, Transaction>();
    allYears.forEach((y) => {
      const list = transactionDao.getTransactionsByYear(String(y));
      list.forEach((tx) => allTransactionsMap.set(tx.id, tx));
    });

    const recurringRules = recurringDao.getAllRecurringRules();
    const customHolidays = holidayDao.getAllCustomHolidays();
    const parseExceptions = parseExceptionDao.getAllExceptions();
    const rawAppNotifications = appNotificationDao.getRecentNotifications();

    // 최근 24개월 수동 입력 할부금 수집
    const manualInstallments: { [yearMonth: string]: number } = {};
    const currentMoment = dayjs();
    for (let i = -12; i <= 12; i++) {
      const ym = currentMoment.add(i, 'month').format('YYYY-MM');
      const val = getManualInstallment(ym);
      if (val > 0) {
        manualInstallments[ym] = val;
      }
    }

    const backupObj: BudgetAppBackupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      user: {
        nickname,
        nicknameCreatedAt,
        monthlyBudget,
        viewMode,
        userKey: require('../storage/userKeyService').getUserKey(),
      },
      transactions: Array.from(allTransactionsMap.values()),
      recurringRules,
      customHolidays,
      parseExceptions: parseExceptions.map((e) => ({
        keyword: e.keyword,
        applyPush: e.applyPush,
        applySms: e.applySms,
      })),
      manualInstallments,
      rawAppNotifications,
    };

    return JSON.stringify(backupObj, null, 2);
  },

  async exportBackupToFile(isDailyAutoBackup: boolean = false): Promise<{ success: boolean; fileName: string; filePath: string }> {
    const jsonString = this.generateBackupJson();
    const fileName = `backup_${dayjs().format('YYYYMMDDHHmmss')}.txt`;

    if (NativeModules.PostgresBackupModule && typeof NativeModules.PostgresBackupModule.syncSettingsToPrefs === 'function') {
      const parsed = JSON.parse(jsonString);
      NativeModules.PostgresBackupModule.syncSettingsToPrefs(
        JSON.stringify(parsed.user || {}),
        JSON.stringify(parsed.manualInstallments || {})
      );
    }

    // 안드로이드 물리 스마트폰 Download 공개 디렉토리에 실제 backup_YYYYMMDDhhmmss.txt 파일만 저장
    if (SmsHistoryParserModule && typeof SmsHistoryParserModule.saveBackupFileToDownload === 'function') {
      try {
        const savedPath = await SmsHistoryParserModule.saveBackupFileToDownload(jsonString, fileName, isDailyAutoBackup);
        return { success: true, fileName, filePath: savedPath };
      } catch (e) {
        return { success: false, fileName, filePath: '' };
      }
    }

    return { success: false, fileName, filePath: '' };
  },

  async runDailyAutoBackup(): Promise<void> {
    try {
      const { storage } = require('../storage/mmkv');
      const lastBackup = storage.getString('last_daily_backup_date');
      const todayStr = dayjs().format('YYYY-MM-DD');

      if (lastBackup === todayStr) {
        return; // 이미 오늘 백업 완료
      }

      // 1. 로컬 파일 백업 (기존 파일 삭제)
      const localResult = await this.exportBackupToFile(true);
      if (!localResult.success) {
        console.warn('Daily auto local backup skipped/failed');
      }

      // 2. 원격 DB 백업 (설정에서 활성화된 경우에만 실행)
      const { getRemoteDbSyncEnabled } = require('../storage/mmkv');
      if (getRemoteDbSyncEnabled()) {
        const result = await this.backupToRemoteDb();
        if (result.success) {
          storage.set('last_daily_backup_date', todayStr);
          console.log('✅ 매일 1회 원격 및 로컬 파일 백업 완료');
        }
      } else if (localResult.success) {
        storage.set('last_daily_backup_date', todayStr);
        console.log('✅ 매일 1회 로컬 파일 백업 완료 (원격 DB 미활성화)');
      }
    } catch (e) {
      console.warn('Daily auto backup failed:', e);
    }
  },

  async backupToRemoteDb(): Promise<{ success: boolean; message: string }> {
    try {
      const userKey = require('../storage/userKeyService').getUserKey();
      const jsonString = this.generateBackupJson();
      const backupData = JSON.parse(jsonString);

      const method = 'POST' as const;
      const pathWithQuery = `/api/backup/${encodeURIComponent(userKey)}`;
      const rawBodyString = JSON.stringify(backupData);

      const res = await fetchWithTimeout(`${API_BASE_URL}${pathWithQuery}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...buildStrictAuthHeaders(method, pathWithQuery, rawBodyString),
        },
        body: rawBodyString,
      });
      const result = await res.json();
      if (!res.ok) {
        return { success: false, message: result.detail || result.message || '원격 DB 백업 실패' };
      }
      return { success: true, message: '원격 DB에 백업이 완료되었습니다.' };
    } catch (e: any) {
      return { success: false, message: e.message || '원격 DB 백업 중 통신 오류가 발생했습니다.' };
    }
  },

  async restoreFromRemoteDb(inputUserKey?: string): Promise<{ success: boolean; message: string }> {
    try {
      const userKey = inputUserKey || require('../storage/userKeyService').getUserKey();

      const method = 'GET' as const;
      const pathWithQuery = `/api/restore/${encodeURIComponent(userKey)}`;

      // GET 요청 등 본문이 없으면 빈 문자열 ""의 SHA-256 해시를 생성
      const res = await fetchWithTimeout(`${API_BASE_URL}${pathWithQuery}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...buildStrictAuthHeaders(method, pathWithQuery, ''),
        },
      });
      const result = await res.json();
      if (!res.ok) {
        return { success: false, message: result.detail || result.message || '원격 DB 복구 실패' };
      }

      if (!result || Object.keys(result).length === 0 || (!result.user && !result.transactions)) {
        return { success: false, message: '해당 키값에 저장된 백업 데이터가 없습니다.' };
      }

      const jsonString = JSON.stringify(result);
      const syncRes = await this.restoreAndSyncInbox(jsonString, true);
      if (syncRes.success && inputUserKey) {
        require('../storage/userKeyService').setUserKey(inputUserKey);
      }
      return syncRes;
    } catch (e: any) {
      return { success: false, message: e.message || '원격 DB 복구 중 통신 오류가 발생했습니다.' };
    }
  },

  restoreFromBackupJson(jsonString: string): { success: boolean; message: string } {
    try {
      const data: BudgetAppBackupData = JSON.parse(jsonString);

      if (!data || typeof data !== 'object') {
        return { success: false, message: '유효하지 않은 백업 데이터 포맷입니다.' };
      }

      // 1. 사용자 기본 설정 복구
      let userData = data.user as any;
      if (Array.isArray(userData) && userData.length > 0) {
        userData = userData[0];
      }
      if (userData && typeof userData === 'object') {
        const nickname = userData.nickname;
        const nicknameCreatedAt = userData.nicknameCreatedAt || userData.nickname_created_at;
        const monthlyBudget = Number(userData.monthlyBudget || userData.monthly_budget || 0);
        const viewMode = userData.viewMode || userData.view_mode;
        const userKey = userData.userKey || userData.user_key;

        if (nickname) setNickname(nickname);
        if (nicknameCreatedAt) setNicknameCreatedAt(nicknameCreatedAt);
        if (monthlyBudget > 0) setMonthlyBudget(monthlyBudget);
        if (viewMode) setViewMode(viewMode as any);
        if (userKey) require('../storage/userKeyService').setUserKey(userKey);
      }

      // 2. 파싱 예외 단어 먼저 복구 (네이버페이는 applySms가 false이므로 문자는 허용)
      if (Array.isArray(data.parseExceptions)) {
        data.parseExceptions.forEach((ex: any) => {
          try {
            const kw = ex.keyword;
            const applyPush = ex.applyPush ?? ex.apply_push ?? true;
            const applySms = ex.applySms ?? ex.apply_sms ?? true;
            if (kw) {
              parseExceptionDao.insertException(kw, Boolean(applyPush), Boolean(applySms));
            }
          } catch (e) {
            // Ignore
          }
        });
      }

      // 3. 거래 내역 복구 (applySms가 false인 네이버페이는 차단 없이 안전하게 복구 인서트)
      if (Array.isArray(data.transactions)) {
        data.transactions.forEach((tx) => {
          try {
            transactionDao.insertTransaction(tx);
          } catch (e) {
            // Ignore duplicate insert errors
          }
        });
      }

      // 4. 앱 푸시 알림 로그 복구 (영구보관 is_bookmarked 체크 상태 완벽 복원)
      if (Array.isArray(data.rawAppNotifications)) {
        try {
          safeDbExecute('ALTER TABLE app_notifications_raw ADD COLUMN is_bookmarked BOOLEAN DEFAULT 0;');
        } catch (e) {}

        data.rawAppNotifications.forEach((n) => {
          try {
            const notifId = n.id || `${Date.now()}_${Math.random()}`;
            const pkgName = n.packageName || (n as any).package_name || '';
            const titleStr = n.title || '';
            const textStr = n.text || '';
            const bigTextStr = n.bigText || (n as any).big_text || '';
            const rawContentStr = n.rawContent || (n as any).raw_content || '';
            const postTimeStr = n.postTime || (n as any).post_time || '';
            const isBookmarkedVal = n.isBookmarked || (n as any).is_bookmarked ? 1 : 0;

            safeDbExecute(
              'INSERT OR REPLACE INTO app_notifications_raw (id, package_name, title, text, big_text, raw_content, post_time, is_bookmarked) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
              [
                notifId,
                pkgName,
                titleStr,
                textStr,
                bigTextStr,
                rawContentStr,
                postTimeStr,
                isBookmarkedVal,
              ]
            );

            // 이미 동일한 ID 또는 동일한 내용의 알림이 DB에 먼저 수록되어 있던 경우에도 백업본의 영구보관 체크 상태를 그대로 반영
            if (isBookmarkedVal === 1) {
              safeDbExecute(
                'UPDATE app_notifications_raw SET is_bookmarked = 1 WHERE id = ? OR (package_name = ? AND post_time = ? AND raw_content = ?);',
                [notifId, pkgName, postTimeStr, rawContentStr]
              );
            }
          } catch (e) {
            // Ignore
          }
        });
      }

      // 5. 정기 결제 내역 복구
      if (Array.isArray(data.recurringRules)) {
        data.recurringRules.forEach((rule) => {
          try {
            recurringDao.insertRecurringRule(rule);
          } catch (e) {
            // Ignore
          }
        });
      }

      // 6. 커스텀 공휴일 복구
      if (Array.isArray(data.customHolidays)) {
        data.customHolidays.forEach((h) => {
          try {
            holidayDao.upsertHoliday(h);
          } catch (e) {
            // Ignore
          }
        });
      }

      // 7. 수동 입력 할부금 복구
      if (data.manualInstallments && typeof data.manualInstallments === 'object') {
        if (Array.isArray(data.manualInstallments)) {
          data.manualInstallments.forEach((item: any) => {
            const ym = item.year_month || item.yearMonth;
            const amt = Number(item.amount);
            if (ym && !isNaN(amt)) {
              setManualInstallment(ym, amt);
            }
          });
        } else {
          Object.keys(data.manualInstallments).forEach((ym) => {
            const val = (data.manualInstallments as any)[ym];
            const amt = typeof val === 'object' ? Number(val.amount) : Number(val);
            if (!isNaN(amt)) {
              setManualInstallment(ym, amt);
            }
          });
        }
      }

      // 8. 복구 완료 후 applySms가 true인 진짜 파싱 예외 단어에 대해서만 정제 삭제 실행 (네이버페이는 보존)
      transactionDao.purgeAllExceptionMatchedTransactions();

      return { success: true, message: '백업 데이터(거래 내역, 정기결제, 앱푸시로그 등)가 완벽 복구되었습니다!' };
    } catch (e: any) {
      return { success: false, message: `복구 중 오류가 발생했습니다: ${e?.message || e}` };
    }
  },

  // 1-1. DB 백업 데이터 1순위 복원 ➔ 1-2. RCS/SMS/MMS/APP PUSH 수신함 스캔 후 기존 DB에 없던 신규 결제건 기록
  async restoreAndSyncInbox(jsonString: string, isRemote: boolean = false): Promise<{ success: boolean; message: string }> {
    // 1-1. DB에 저장된 건 1순위 복원
    const restoreResult = this.restoreFromBackupJson(jsonString);
    if (!restoreResult.success) {
      return restoreResult;
    }

    // 1-2. RCS, SMS, MMS, APP PUSH에서 파싱된 건 중에 기존 DB에 존재하지 않는 건 추가 기록
    let newlySyncedCount = 0;
    try {
      const nicknameDate = getNicknameCreatedAt() || 'ALL';
      if (SmsHistoryParserModule && typeof SmsHistoryParserModule.syncSmsHistoryWithLog === 'function') {
        const syncRes = await SmsHistoryParserModule.syncSmsHistoryWithLog(nicknameDate);
        newlySyncedCount = syncRes?.count || 0;
      }
    } catch (e) {}

    const sourceText = isRemote ? '원격 DB 동기화' : '백업 파일';
    return {
      success: true,
      message: `[1순위] ${sourceText} 내역이 정상 복구되었으며,\n[2순위] 수신함(RCS/SMS/MMS/푸시) 스캔을 거쳐 기존 DB에 없는 신규 결제건 ${newlySyncedCount}건을 추가 수록했습니다!`,
    };
  },
};
