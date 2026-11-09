import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  Modal,
  NativeModules,
  Switch,
} from 'react-native';
import dayjs from 'dayjs';
import { useFocusEffect } from '@react-navigation/native';
import { RecurringRule, Holiday } from '../types/budget';
import {
  getMonthlyBudget,
  setMonthlyBudget,
  getLastHolidaySync,
  getNicknameCreatedAt,
} from '../storage/mmkv';
import { recurringDao } from '../database/recurringDao';
import { holidayDao } from '../database/holidayDao';
import { holidayService } from '../services/holidayService';
import { syncSmsHistoryForDate } from '../services/smsHistoryService';
import { backupService } from '../services/backupService';
import { RecurringRuleModal } from '../components/settings/RecurringRuleModal';
import { SmsSyncHistoryModal } from '../components/settings/SmsSyncHistoryModal';
import { formatNumberWithComma, parseNumberFromComma } from '../utils/budgetUtils';

const { SmsHistoryParserModule } = NativeModules;

interface SettingsScreenProps {
  navigation?: any;
  onOpenCustomHolidays?: () => void;
  onOpenAppNotifications?: () => void;
  onOpenParseExceptions?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  navigation,
  onOpenCustomHolidays,
  onOpenAppNotifications,
  onOpenParseExceptions,
}) => {
  const [budgetStr, setBudgetStr] = useState(formatNumberWithComma(getMonthlyBudget()));
  const [lastSync, setLastSync] = useState(getLastHolidaySync());
  const [isSyncing, setIsSyncing] = useState(false);

  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedRule, setSelectedRule] = useState<RecurringRule | null>(null);

  const [customHolidays, setCustomHolidays] = useState<Holiday[]>([]);
  const [customDate, setCustomDate] = useState('');
  const [customName, setCustomName] = useState('');

  // 팝업 모달 상태
  const [smsSyncModalVisible, setSmsSyncModalVisible] = useState(false);
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);

  const [userKey, setUserKey] = useState('');
  const [isRemoteSyncEnabled, setIsRemoteSyncEnabled] = useState(false);

  const loadSettingsData = useCallback(() => {
    const budget = require('../storage/mmkv').getMonthlyBudget(dayjs().format('YYYY-MM'));
    setBudgetStr(require('../utils/budgetUtils').formatNumberWithComma(budget));

    setRecurringRules(recurringDao.getAllRecurringRules());
    const list = holidayDao.getAllCustomHolidays();
    setCustomHolidays(list);
    setLastSync(getLastHolidaySync());
    setUserKey(require('../storage/userKeyService').getUserKey());
    setIsRemoteSyncEnabled(require('../storage/mmkv').getRemoteDbSyncEnabled());
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSettingsData();
    }, [loadSettingsData])
  );

  const formatRepeatLabel = (rule: RecurringRule): string => {
    const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');

    if (repeatType === 'DAILY') {
      return '매일';
    } else if (repeatType === 'WEEKLY_DAYS') {
      const daysMap: { [key: number]: string } = {
        1: '월',
        2: '화',
        3: '수',
        4: '목',
        5: '금',
        6: '토',
        0: '일',
      };
      const days = (rule.daysOfWeek || []).map((d) => daysMap[d] || '').filter(Boolean);
      return days.length > 0 ? `매주 (${days.join(', ')})` : '매주';
    } else {
      return `매월 ${rule.dayOfMonth}일`;
    }
  };

  const handleToggleRemoteSync = (value: boolean) => {
    require('../storage/mmkv').setRemoteDbSyncEnabled(value);
    setIsRemoteSyncEnabled(value);
  };

  const handleSaveBudget = () => {
    const val = parseNumberFromComma(budgetStr);
    if (isNaN(val) || val <= 0) {
      Alert.alert('알림', '유효한 예산 금액을 입력해 주세요.');
      return;
    }
    setMonthlyBudget(val);
    const currentMonthLabel = dayjs().format('YYYY년 M월');
    Alert.alert('성공', `${currentMonthLabel}의 목표 예산 및 기본 예산이 변경되었습니다.`);
  };

  const handleSyncHolidays = async () => {
    setIsSyncing(true);
    const year = dayjs().year();
    const success = await holidayService.syncHolidays(year);
    setIsSyncing(false);

    if (success) {
      Alert.alert('동기화 완료', `${year}년 공휴일 정보를 수신하여 저장했습니다.`);
    } else {
      Alert.alert('안내', '네트워크 미연결로 기본 내장 공휴일 데이터를 세팅했습니다.');
    }
    loadSettingsData();
  };

  // 실시간 수신함 동기화 실행 (가입월 1일부터 실시간 반영)
  const handleSyncSmsHistory = async () => {
    const nicknameDate = getNicknameCreatedAt();
    setIsSyncing(true);
    const count = await syncSmsHistoryForDate(nicknameDate);
    setIsSyncing(false);

    const monthStartStr = nicknameDate.length >= 7 ? `${nicknameDate.substring(0, 7)}-01` : '1일';

    if (count > 0) {
      Alert.alert('동기화 완료', `가입월 1일(${monthStartStr})부터 수신된 카드 결제 내역 ${count}건을 가계부에 실시간 반영했습니다!`);
    } else {
      Alert.alert('동기화 완료', '수신함에서 새로 등록할 신규 카드 결제 내역이 없습니다.');
    }
  };

  // 가계부 전체 데이터 backup_YYYYMMDDhhmmss.txt 파일 백업 생성 다운로드
  const handleExportBackupData = async () => {
    try {
      setIsSyncing(true);
      const result = await backupService.exportBackupToFile();
      setIsSyncing(false);

      Alert.alert(
        '📄 백업 파일 다운로드 완료',
        `가계부 전체 데이터가 '${result.fileName}' 파일로 스마트폰 [Download] 폴더에 물리적으로 생성 다운로드되었습니다!\n\n(생성 경로: ${result.filePath})\n용량이 커도 텍스트 파일(${result.fileName}) 형태로 안심하고 보관/이동하실 수 있습니다.`
      );
    } catch (e: any) {
      setIsSyncing(false);
      Alert.alert('백업 실패', e?.message || '백업 파일 생성 중 오류가 발생했습니다.');
    }
  };

  // 탐색기에서 백업 파일 선택 및 자동 업로드 복구 (1순위 백업 DB 복원 -> 2순위 수신함 신규 결제건 기록)
  const handlePickFileAndRestore = async () => {
    try {
      if (SmsHistoryParserModule && typeof SmsHistoryParserModule.pickBackupFileAndRead === 'function') {
        const fileContent: string = await SmsHistoryParserModule.pickBackupFileAndRead();
        if (!fileContent || !fileContent.trim()) {
          Alert.alert('알림', '선택된 백업 파일에 데이터가 없습니다.');
          return;
        }

        setIsSyncing(true);
        const result = await backupService.restoreAndSyncInbox(fileContent.trim());
        setIsSyncing(false);

        if (result.success) {
          setRestoreModalVisible(false);
          loadSettingsData();
          Alert.alert('복구 및 신규 동기화 완료', result.message);
        } else {
          Alert.alert('복구 실패', result.message);
        }
      } else {
        Alert.alert('알림', '파일 탐색기를 열 수 없습니다.');
      }
    } catch (e: any) {
      setIsSyncing(false);
      if (e?.code !== 'PICK_CANCELLED') {
        Alert.alert('오류', e?.message || '파일을 읽는 중 오류가 발생했습니다.');
      }
    }
  };

  // 알림 접근 권한(NotificationListenerService) 설정 화면 열기
  const handleOpenNotificationAccessSettings = () => {
    if (Platform.OS === 'android') {
      try {
        Linking.sendIntent('android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS');
      } catch (e) {
        Alert.alert('안내', '스마트폰 [설정 -> 애플리케이션 -> 특별한 접근 -> 알림 접근 허용]에서 예산가계부를 허용해 주세요.');
      }
    }
  };

  const handleOpenNotificationsNav = () => {
    if (onOpenAppNotifications) {
      onOpenAppNotifications();
    } else if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('AppNotifications');
    }
  };

  const handleOpenParseExceptionsNav = () => {
    if (onOpenParseExceptions) {
      onOpenParseExceptions();
    } else if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('ParseExceptions');
    }
  };

  const handleAddRule = () => {
    setSelectedRule(null);
    setModalVisible(true);
  };

  const handleEditRule = (rule: RecurringRule) => {
    setSelectedRule(rule);
    setModalVisible(true);
  };

  const handleSaveRule = (rule: RecurringRule) => {
    if (selectedRule) {
      recurringDao.updateRecurringRule(rule);
    } else {
      recurringDao.insertRecurringRule(rule);
    }
    loadSettingsData();
  };

  const handleDeleteRule = (id: string) => {
    Alert.alert('정기결제 삭제', '해당 정기 결제 내역을 삭제하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          recurringDao.deleteRecurringRule(id);
          loadSettingsData();
        },
      },
    ]);
  };

  const handleAddCustomHoliday = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customDate)) {
      Alert.alert('알림', '날짜 형식(YYYY-MM-DD)에 맞춰 입력해 주세요.');
      return;
    }
    if (!customName.trim()) {
      Alert.alert('알림', '공휴일 명칭을 입력해 주세요.');
      return;
    }

    holidayDao.upsertHoliday({
      locdate: customDate,
      dateName: customName.trim(),
      isHoliday: true,
      isCustom: true,
    });

    setCustomDate('');
    setCustomName('');
    Alert.alert('성공', '임시 공휴일이 추가되었습니다.');
    loadSettingsData();
  };

  const handleDeleteCustomHoliday = (locdate: string) => {
    holidayDao.deleteCustomHoliday(locdate);
    loadSettingsData();
  };

  const handleOpenCustomHolidaysScreen = () => {
    if (onOpenCustomHolidays) {
      onOpenCustomHolidays();
    } else if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('CustomHolidays');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 1. 월 예산 설정 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>💰 목표 예산 설정</Text>
        <Text style={styles.sectionSub}>
          한 달 권장 예상 지출을 설정하여 일일 권장 금액을 계산합니다.
        </Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            keyboardType="numeric"
            value={budgetStr}
            onChangeText={(text) => setBudgetStr(formatNumberWithComma(text))}
            autoCapitalize="none"
            autoCorrect={false}
            disableFullscreenUI={true}
          />
          <TouchableOpacity
            style={styles.saveBtn}
            activeOpacity={0.7}
            delayPressIn={0}
            onPress={handleSaveBudget}
          >
            <Text style={styles.saveBtnText}>저장</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. 결제 데이터 파일 백업 및 복구 영역 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📦 백업 파일 다운로드 및 복구</Text>
        <Text style={styles.sectionSub}>
          가계부 이력 전체를 'backup_YYYYMMDDhhmmss.txt' 파일로 생성하여 Download 폴더에 다운로드하거나 복구합니다.
        </Text>
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.syncBtn, { flex: 1, backgroundColor: '#4CAF50' }]}
            activeOpacity={0.7}
            delayPressIn={0}
            onPress={handleExportBackupData}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.syncBtnText}>📄 백업</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.syncBtn, { flex: 1, backgroundColor: '#00BCD4' }]}
            activeOpacity={0.7}
            delayPressIn={0}
            onPress={async () => {
              setIsSyncing(true);
              const result = await backupService.backupToRemoteDb();
              setIsSyncing(false);
              Alert.alert(result.success ? '백업 성공' : '백업 실패', result.message);
            }}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.syncBtnText}>☁️ 원격 DB</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.syncBtn, { flex: 1, backgroundColor: '#FF9800' }]}
            activeOpacity={0.7}
            delayPressIn={0}
            onPress={() => setRestoreModalVisible(true)}
          >
            <Text style={styles.syncBtnText}>📥 복구</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 3. 결제 문자 / 푸시 수신함 실시간 동기화 및 관리 메뉴 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📱 수신함 결제 내역 실시간 동기화</Text>
        <Text style={styles.sectionSub}>
          수신함의 카드 결제 문자 및 알림 푸시를 스캔하여 가계부에 실시간 등록합니다.
        </Text>
        <TouchableOpacity
          style={[styles.syncBtn, { backgroundColor: '#2196F3' }]}
          activeOpacity={0.7}
          delayPressIn={0}
          onPress={handleSyncSmsHistory}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.syncBtnText}>📱 수신함 결제 내역 실시간 동기화 실행</Text>
          )}
        </TouchableOpacity>

        {/* 수신함 결제 문자 동기화 내역 보기 POPUP 버튼 */}
        <TouchableOpacity
          style={[styles.menuNavBtn, { backgroundColor: '#E0F2F1', borderColor: '#80CBC4' }]}
          activeOpacity={0.7}
          delayPressIn={0}
          onPress={() => setSmsSyncModalVisible(true)}
        >
          <Text style={[styles.menuNavBtnText, { color: '#00695C' }]}>
            📋 수신함 결제 문자 동기화 파싱 내역 보기 (POPUP) ➔
          </Text>
        </TouchableOpacity>

        {/* 실시간 앱 푸시 알림 접근 권한 활성화 버튼 */}
        <TouchableOpacity
          style={styles.notifAccessBtn}
          activeOpacity={0.7}
          delayPressIn={0}
          onPress={handleOpenNotificationAccessSettings}
        >
          <Text style={styles.notifAccessBtnText}>🔔 실시간 앱 푸시 알림 접근 권한 설정 (터치하여 활성화)</Text>
        </TouchableOpacity>

        {/* 수신된 앱 푸시 원문 로그 목록 메뉴 버튼 */}
        <TouchableOpacity
          style={styles.menuNavBtn}
          activeOpacity={0.7}
          delayPressIn={0}
          onPress={handleOpenNotificationsNav}
        >
          <Text style={styles.menuNavBtnText}>📨 수신된 앱 푸시 원문 로그 목록 (표 형태 조회) ➔</Text>
        </TouchableOpacity>

        {/* 파싱 예외 문구 관리 메뉴 버튼 */}
        <TouchableOpacity
          style={[styles.menuNavBtn, { backgroundColor: '#FFF3E0', borderColor: '#FFB74D' }]}
          activeOpacity={0.7}
          delayPressIn={0}
          onPress={handleOpenParseExceptionsNav}
        >
          <Text style={[styles.menuNavBtnText, { color: '#E65100' }]}>🚫 결제 파싱 예외 문구 등록/관리 ➔</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🔑 사용자 고유 키값 및 자동 백업 설정</Text>
        <Text style={styles.sectionSub}>
          여러 유저가 자신의 데이터를 원격 DB에 안전하게 업로드할 수 있도록 발급된 고유 식별자입니다.
        </Text>
        <TextInput
          style={[styles.input, { backgroundColor: '#F0F0F0', color: '#757575', fontWeight: 'bold', textAlign: 'center', marginBottom: 16 }]}
          value={userKey}
          editable={false}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>☁️ 매일 1회 원격 DB 자동 백업 활성화</Text>
          <Switch
            value={isRemoteSyncEnabled}
            onValueChange={handleToggleRemoteSync}
            trackColor={{ false: '#E0E0E0', true: '#81C784' }}
            thumbColor={isRemoteSyncEnabled ? '#4CAF50' : '#F5F5F5'}
          />
        </View>
        <Text style={styles.metaText}>
          활성화 시 매일 첫 앱 실행 또는 화면을 켤 때 로컬 파일과 원격 DB에 최신 데이터가 자동으로 교체 저장됩니다.
        </Text>
      </View>

      {/* 4. 공휴일 동기화 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🗓️ 공휴일 API 동기화</Text>
        <Text style={styles.sectionSub}>
          한국천문연구원 API를 통해 해당 연도의 법정/임시공휴일을 수신합니다.
        </Text>
        <Text style={styles.metaText}>
          최근 동기화 시각:{' '}
          {lastSync ? dayjs(lastSync).format('YYYY-MM-DD HH:mm') : '없음'}
        </Text>
        <TouchableOpacity
          style={styles.syncBtn}
          activeOpacity={0.7}
          delayPressIn={0}
          onPress={handleSyncHolidays}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.syncBtnText}>🔄 공휴일 최신 동기화 실행</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* 5. 정기 결제 관리 */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>🔄 정기 결제 내역 관리</Text>
          <TouchableOpacity
            style={styles.addBtn}
            activeOpacity={0.7}
            delayPressIn={0}
            onPress={handleAddRule}
          >
            <Text style={styles.addBtnText}>+ 등록</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionSub}>
          매달 반복되는 지출(영업일 이관) 및 적금(날짜 고정)을 관리합니다.
        </Text>

        {recurringRules.map((rule) => (
          <View key={rule.id} style={styles.itemCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>
                {formatRepeatLabel(rule)} | {rule.merchant} (
                {rule.categoryType === 'EXPENSE' ? '지출' : '적금'})
              </Text>
              <Text style={styles.itemSub}>
                {rule.amount.toLocaleString()}원 (
                {rule.paymentType === 'CARD' ? rule.cardCompany || '카드' : '현금'})
              </Text>
            </View>
            <View style={styles.actionBadgeRow}>
              <TouchableOpacity
                onPress={() => handleEditRule(rule)}
                style={styles.editBadge}
                activeOpacity={0.7}
                delayPressIn={0}
              >
                <Text style={styles.editBadgeText}>수정</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDeleteRule(rule.id)}
                style={styles.deleteBadge}
                activeOpacity={0.7}
                delayPressIn={0}
              >
                <Text style={styles.deleteBadgeText}>삭제</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* 6. 임시 공휴일 수동 관리 및 페이지 이동 */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>✏️ 임시공휴일 수동 관리</Text>
          <TouchableOpacity
            style={styles.manageBtn}
            activeOpacity={0.7}
            delayPressIn={0}
            onPress={handleOpenCustomHolidaysScreen}
          >
            <Text style={styles.manageBtnText}>목록 전체 관리 ➔</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionSub}>
          사용자가 직접 특정 일자를 임시공휴일로 추가하거나 관리 화면에서 수정/삭제합니다.
        </Text>

        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="YYYY-MM-DD"
            value={customDate}
            onChangeText={setCustomDate}
            autoCapitalize="none"
            autoCorrect={false}
            disableFullscreenUI={true}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="공휴일 명칭"
            value={customName}
            onChangeText={setCustomName}
            autoCapitalize="none"
            autoCorrect={false}
            disableFullscreenUI={true}
          />
          <TouchableOpacity
            style={styles.saveBtn}
            activeOpacity={0.7}
            delayPressIn={0}
            onPress={handleAddCustomHoliday}
          >
            <Text style={styles.saveBtnText}>추가</Text>
          </TouchableOpacity>
        </View>

        {customHolidays.map((h) => (
          <View key={h.locdate} style={styles.itemCard}>
            <Text style={styles.itemTitle}>
              {h.locdate} ({h.dateName})
            </Text>
            <TouchableOpacity
              onPress={() => handleDeleteCustomHoliday(h.locdate)}
              style={styles.deleteBadge}
              activeOpacity={0.7}
              delayPressIn={0}
            >
              <Text style={styles.deleteBadgeText}>삭제</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <RecurringRuleModal
        visible={modalVisible}
        initialData={selectedRule}
        onClose={() => setModalVisible(false)}
        onSave={handleSaveRule}
      />

      {/* 수신함 결제 문자 동기화 파싱 내역 보기 POPUP 모달 */}
      <SmsSyncHistoryModal
        visible={smsSyncModalVisible}
        onClose={() => setSmsSyncModalVisible(false)}
      />

      {/* 백업 데이터 복구 모달 */}
      <Modal
        visible={restoreModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRestoreModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>📥 백업 데이터 복구</Text>
            <Text style={styles.modalSubText}>
              원하는 복구 방식을 선택해 주세요. 원격 DB 복구는 사용자 고유 키값으로 조회된 모든 데이터를 가져와 복원합니다.
            </Text>

            <TouchableOpacity
              style={styles.pickFileBtn}
              activeOpacity={0.7}
              delayPressIn={0}
              onPress={handlePickFileAndRestore}
            >
              <Text style={styles.pickFileBtnText}>📁 로컬 백업 파일 선택 (backup_*.txt)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.pickFileBtn, { backgroundColor: '#00BCD4', marginTop: 10 }]}
              activeOpacity={0.7}
              delayPressIn={0}
              onPress={async () => {
                setIsSyncing(true);
                const result = await backupService.restoreFromRemoteDb();
                setIsSyncing(false);
                if (result.success) {
                  setRestoreModalVisible(false);
                  loadSettingsData();
                  Alert.alert('복구 성공', result.message);
                } else {
                  Alert.alert('복구 실패', result.message);
                }
              }}
            >
              <Text style={styles.pickFileBtnText}>☁️ 원격 DB에서 복원</Text>
            </TouchableOpacity>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#F5F5F5' }]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => setRestoreModalVisible(false)}
              >
                <Text style={{ color: '#666666', fontWeight: 'bold' }}>취소</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  content: {
    padding: 16,
    paddingBottom: 80,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionSub: {
    fontSize: 12,
    color: '#757575',
    marginTop: 4,
    marginBottom: 12,
  },
  metaText: {
    fontSize: 12,
    color: '#9E9E9E',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#212121',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  switchLabel: {
    fontSize: 14,
    color: '#333333',
    fontWeight: 'bold',
  },
  saveBtn: {
    backgroundColor: '#2196F3',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  syncBtn: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  syncBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  notifAccessBtn: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#90CAF9',
  },
  notifAccessBtnText: {
    fontSize: 12,
    color: '#1565C0',
    fontWeight: '600',
  },
  menuNavBtn: {
    marginTop: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  menuNavBtnText: {
    fontSize: 12,
    color: '#424242',
    fontWeight: 'bold',
  },
  addBtn: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  addBtnText: {
    color: '#1976D2',
    fontWeight: 'bold',
    fontSize: 12,
  },
  manageBtn: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  manageBtnText: {
    color: '#1976D2',
    fontWeight: 'bold',
    fontSize: 12,
  },
  itemCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#212121',
  },
  itemSub: {
    fontSize: 12,
    color: '#757575',
    marginTop: 2,
  },
  actionBadgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  editBadge: {
    backgroundColor: '#E0E0E0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  editBadgeText: {
    fontSize: 12,
    color: '#424242',
    fontWeight: '600',
  },
  deleteBadge: {
    backgroundColor: '#FFEBEE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  deleteBadgeText: {
    fontSize: 12,
    color: '#D32F2F',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 18,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 6,
  },
  modalSubText: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 16,
    lineHeight: 16,
  },
  pickFileBtn: {
    backgroundColor: '#2196F3',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 14,
  },
  pickFileBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  modalBtnRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
});
