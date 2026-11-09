import { MMKV } from 'react-native-mmkv';
import dayjs from 'dayjs';
import { ViewMode } from '../types/budget';

export const storage = new MMKV({ id: 'budget-app-storage' });

const KEYS = {
  USER_NICKNAME: 'user_nickname',
  NICKNAME_CREATED_AT: 'nickname_created_at',
  MONTHLY_BUDGET: 'monthly_budget',
  CALENDAR_VIEW_MODE: 'calendar_view_mode',
  LAST_HOLIDAY_SYNC: 'last_holiday_sync',
  REMOTE_DB_SYNC_ENABLED: 'remote_db_sync_enabled',
};

export const getNickname = (): string | null => {
  return storage.getString(KEYS.USER_NICKNAME) || null;
};

export const setNickname = (nickname: string): void => {
  storage.set(KEYS.USER_NICKNAME, nickname);
};

export const getNicknameCreatedAt = (): string => {
  return storage.getString(KEYS.NICKNAME_CREATED_AT) || '2026-10-12';
};

export const setNicknameCreatedAt = (dateStr: string): void => {
  storage.set(KEYS.NICKNAME_CREATED_AT, dateStr);
};

export const getMonthlyBudget = (yearMonthStr?: string): number => {
  const globalBudget = storage.getNumber(KEYS.MONTHLY_BUDGET) ?? 1500000;
  if (!yearMonthStr) return globalBudget;

  const monthlyKey = `budget_${yearMonthStr}`;
  if (storage.contains(monthlyKey)) {
    return storage.getNumber(monthlyKey) ?? globalBudget;
  }

  // 아직 해당 월의 고정 예산이 없다면, 현재 글로벌 예산으로 DB(MMKV)에 고정 등록
  storage.set(monthlyKey, globalBudget);
  return globalBudget;
};

export const setMonthlyBudget = (budget: number): void => {
  const currentYearMonth = dayjs().format('YYYY-MM');
  // 오늘 날짜가 속한 현재 달의 예산을 덮어씀
  storage.set(`budget_${currentYearMonth}`, budget);
  // 글로벌(미래 달의 기본값) 예산도 같이 업데이트
  storage.set(KEYS.MONTHLY_BUDGET, budget);
};

export const getViewMode = (): ViewMode => {
  const mode = storage.getString(KEYS.CALENDAR_VIEW_MODE);
  return mode === 'WEEKLY' ? 'WEEKLY' : 'MONTHLY';
};

export const setViewMode = (mode: ViewMode): void => {
  storage.set(KEYS.CALENDAR_VIEW_MODE, mode);
};

export const getLastHolidaySync = (): string | null => {
  return storage.getString(KEYS.LAST_HOLIDAY_SYNC) || null;
};

export const setLastHolidaySync = (isoTimestamp: string): void => {
  storage.set(KEYS.LAST_HOLIDAY_SYNC, isoTimestamp);
};

export const getManualInstallment = (yearMonthStr: string): number => {
  return storage.getNumber(`manual_installment_${yearMonthStr}`) ?? 0;
};

export const setManualInstallment = (yearMonthStr: string, amount: number): void => {
  storage.set(`manual_installment_${yearMonthStr}`, amount);
};

export const getRemoteDbSyncEnabled = (): boolean => {
  return storage.getBoolean(KEYS.REMOTE_DB_SYNC_ENABLED) ?? false;
};

export const setRemoteDbSyncEnabled = (enabled: boolean): void => {
  storage.set(KEYS.REMOTE_DB_SYNC_ENABLED, enabled);
};
