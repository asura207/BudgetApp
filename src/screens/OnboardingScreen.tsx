import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
  Linking,
  Modal,
  ActivityIndicator,
  NativeModules,
  PermissionsAndroid,
} from 'react-native';
import dayjs from 'dayjs';
import { setNickname, setNicknameCreatedAt, setMonthlyBudget } from '../storage/mmkv';
import { syncSmsHistoryForDate } from '../services/smsHistoryService';
import { backupService } from '../services/backupService';
import { formatNumberWithComma, parseNumberFromComma } from '../utils/budgetUtils';

const { SmsHistoryParserModule } = NativeModules;

const ADJECTIVES = [
  '절약하는', '지갑닫은', '소비참는', '부자되는', '무지출',
  '짠돌이', '지혜로운', '계획적인', '통장지키는', '알뜰한',
  '현명한', '검소한', '아껴쓰는', '재테크잘하는', '돈모으는',
  '시드머니버는', '월급지키는', '영수증챙기는', '할인받는', '쿠폰쓰는',
  '부지런한', '꼼꼼한', '똑똑한', '가계부적는', '체크카드쓰는',
  '포인트모으는', '투자하는', '적금붓는', '배당금받는', '자산가되는',
  '성실한', '신중한', '통장쪼개는', '야무진', '똑소리나는',
  '소비자제하는', '복리효과누리는', '수익내는', '절세하는', '연말정산받는',
  '주식하는', '부동산공부하는', '상가사는', '건물주되는', '파이어족',
  '경제관념있는', '수입늘리는', '지출줄이는', '스마트한', '전략적인',
  '눈부신', '용감한', '행복한', '기분좋은', '열정적인',
  '성공하는', '목표달성하는', '1억모으는', '10억만드는', '자산2배되는',
  '든든한', '안전하게버는', '차곡차곡모으는', '한푼두푼아끼는', '낭비없는',
  '실속있는', '짠테크전문가', '가성비찾는', '최저가검색하는', '네이버포인트버는',
  '캐시백받는', '금융지식풍부한', '자산관리하는', '재산늘리는', '복리수익내는',
  '안정적인', '탄탄한', '내집마련하는', '청약당첨되는', '성공투자하는',
  '수익률높은', '통장빵빵한', '머니마스터', '자산상승하는', '기적을만드는',
  '돈벼락맞는', '대박나는', '꽃길걷는', '희망찬', '미래를준비하는'
];

const NOUNS = [
  '곰돌이', '다람쥐', '펭귄', '개미', '토끼',
  '강아지', '고양이', '부엉이', '호랑이', '여우',
  '사자', '판다', '코알라', '사슴', '돌고래',
  '수달', '너구리', '햄스터', '원숭이', '표범',
  '낙타', '코끼리', '기린', '하마', '물개',
  '독수리', '올빼미', '까치', '비둘기', '오리',
  '거위', '백조', '병아리', '공룡', '드래곤',
  '유니콘', '페가수스', '피닉스', '요정', '영웅',
  '대장', '박사', '마스터', '킹', '퀸',
  '왕자', '공주', '기사', '탐험가', '전문가',
  '선생님', '대장님', '파이팅맨', '러너', '부자',
  '건물주', '투자왕', '절약왕', '짠돌이왕', '재테크왕',
  '적금왕', '자산가', '금융왕', '수익왕', '포인트왕',
  '쿠폰왕', '실속왕', '가계부왕', '청약왕', '나비',
  '꿀벌', '무당벌레', '잠자리', '반딧불이', '참새',
  '제비', '두루미', '갈매기', '파랑새', '아기곰',
  '아기사자', '아기호랑이', '아기펭귄', '아기다람쥐', '행복이',
  '대박이', '부자이', '드림이', '희망이', '머니맨'
];

export const getRandomNickname = (): string => {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
};

interface OnboardingScreenProps {
  onComplete: () => void;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({
  onComplete,
}) => {
  const [name, setName] = useState('');
  const [budgetStr, setBudgetStr] = useState('');
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);
  const [remoteKeyInput, setRemoteKeyInput] = useState('');
  const [isRemoteInputVisible, setIsRemoteInputVisible] = useState(false);

  // 프로그레스 바 상태
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');

  const nameInputRef = useRef<TextInput>(null);
  const budgetInputRef = useRef<TextInput>(null);

  useEffect(() => {
    // 마운트 후 가상 키보드 자동 포커스
    const timer = setTimeout(() => {
      nameInputRef.current?.focus();
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  const handleGenerateRandomNickname = () => {
    const randomName = getRandomNickname();
    setName(randomName);
  };

  const requestSmsPermissionsIfNeeded = async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_SMS,
          PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
        ]);
        const isReadGranted = granted[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED;
        const isReceiveGranted = granted[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === PermissionsAndroid.RESULTS.GRANTED;
        return isReadGranted || isReceiveGranted;
      } catch (err) {
        return false;
      }
    }
    return true;
  };

  // 백업 파일 업로드 복구 실행
  const handlePickFileAndRestore = async () => {
    try {
      if (SmsHistoryParserModule && typeof SmsHistoryParserModule.pickBackupFileAndRead === 'function') {
        setRestoreModalVisible(false);
        setIsProcessing(true);
        setProgressPercent(20);
        setProgressMessage('1/4. 백업 파일(backup_*.txt)을 로드 중입니다...');

        const fileContent: string = await SmsHistoryParserModule.pickBackupFileAndRead();
        if (!fileContent || !fileContent.trim()) {
          setIsProcessing(false);
          Alert.alert('알림', '선택한 백업 파일에 데이터가 없습니다.');
          return;
        }

        setProgressPercent(40);
        setProgressMessage('2/4 [1순위]. 백업 데이터(거래 내역, 정기결제, 푸시로그) 1순위 복구 중...');

        const result = backupService.restoreFromBackupJson(fileContent.trim());
        if (!result.success) {
          setIsProcessing(false);
          Alert.alert('복구 실패', result.message);
          return;
        }

        setProgressPercent(70);
        setProgressMessage('3/4 [2순위]. 수신함(RCS/SMS/MMS/푸시) 스캔 및 신규 결제건 기록 중...');

        // SMS 읽기 시스템 권한 팝업 요청
        await requestSmsPermissionsIfNeeded();

        // 1-2. 수신함(RCS/SMS/MMS/푸시) 파싱 건 중 기존 DB에 없는 신규 결제건 기록
        try {
          const nicknameDate = dayjs().format('YYYY-MM-01');
          await syncSmsHistoryForDate(nicknameDate);
        } catch (e) {}

        // 시스템 알림 접근 권한 유도
        if (Platform.OS === 'android') {
          try {
            Linking.sendIntent('android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS');
          } catch (e) {
            // Ignore
          }
        }

        setProgressPercent(100);
        setProgressMessage('4/4. 1순위 백업 복구 및 2순위 신규 동기화 완료! 가계부로 이동합니다.');

        setTimeout(() => {
          setIsProcessing(false);
          onComplete();
        }, 600);
      } else {
        Alert.alert('알림', '파일 탐색기를 열 수 없습니다.');
      }
    } catch (e: any) {
      setIsProcessing(false);
      if (e?.code !== 'PICK_CANCELLED') {
        Alert.alert('오류', e?.message || '파일을 읽는 중 오류가 발생했습니다.');
      }
    }
  };

  const handleRemoteDbRestore = async () => {
    if (!remoteKeyInput || remoteKeyInput.length < 6) {
      Alert.alert('알림', '6자리 사용자 고유 키값을 정확히 입력해 주세요.');
      return;
    }

    setRestoreModalVisible(false);
    setIsProcessing(true);
    setProgressPercent(30);
    setProgressMessage('1/3. 원격 DB에서 백업 데이터를 다운로드 및 복구 중입니다...');

    const result = await backupService.restoreFromRemoteDb(remoteKeyInput.toUpperCase());

    if (!result.success) {
      setIsProcessing(false);
      Alert.alert('복구 실패', result.message);
      return;
    }

    setProgressPercent(80);
    setProgressMessage('2/3. 수신함 SMS 읽기 및 알림 권한 허가 요청 중...');

    await requestSmsPermissionsIfNeeded();
    if (Platform.OS === 'android') {
      try {
        Linking.sendIntent('android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS');
      } catch (e) {}
    }

    setProgressPercent(100);
    setProgressMessage('3/3. 원격 DB 복구가 완료되었습니다! 메인 화면으로 이동합니다.');

    setTimeout(() => {
      setIsProcessing(false);
      onComplete();
    }, 600);
  };

  const handleSave = async () => {
    Keyboard.dismiss();

    // 필수값 검증: 닉네임
    if (!name.trim()) {
      Alert.alert('필수 입력', '사용자 별명(닉네임)을 입력해 주세요.');
      nameInputRef.current?.focus();
      return;
    }

    // 필수값 검증: 예산
    const parsedBudget = parseNumberFromComma(budgetStr);
    if (isNaN(parsedBudget) || parsedBudget <= 0) {
      Alert.alert('필수 입력', '유효한 한 달 예상 사용 금액(예산)을 입력해 주세요.');
      budgetInputRef.current?.focus();
      return;
    }

    setIsProcessing(true);
    setProgressPercent(20);
    setProgressMessage('1/4. 별명 및 목표 예산 정보를 저장하는 중...');

    const todayStr = dayjs().format('YYYY-MM-DD');
    setNickname(name.trim());
    setNicknameCreatedAt(todayStr);
    setMonthlyBudget(parsedBudget);

    setProgressPercent(50);
    setProgressMessage('2/4. 수신함 카드 결제 내역(SMS/RCS) 실시간 분석 중...');

    // 안드로이드 SMS 수신/읽기 권한 요청
    await requestSmsPermissionsIfNeeded();

    try {
      await syncSmsHistoryForDate(todayStr);
    } catch (e) {
      console.warn('SMS sync error:', e);
    }

    setProgressPercent(80);
    setProgressMessage('3/4. 카드 결제 앱 푸시 알림 수신 접근 권한 승인 확인 중...');

    // 닉네임 설정 완료 후 즉시 앱 푸시 알림 접근 권한 승인 유도
    if (Platform.OS === 'android') {
      try {
        Linking.sendIntent('android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS');
      } catch (e) {
        // Ignore
      }
    }

    setProgressPercent(100);
    setProgressMessage('4/4. 설정을 성공적으로 완료했습니다! 100% 가계부로 이동합니다.');

    setTimeout(() => {
      setIsProcessing(false);
      onComplete();
    }, 600);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>예산가계부에 오신 것을 환영합니다! 👋</Text>
          <Text style={styles.subtitle}>
            스탠드얼론 예산가계부 사용을 위한 필수 정보를 설정해 주세요.
          </Text>

          {/* 닉네임 입력 & 랜덤 생성 버튼 */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>사용자 별명 (닉네임) *필수</Text>
            <View style={styles.nicknameRow}>
              <TextInput
                ref={nameInputRef}
                style={[styles.input, { flex: 1 }]}
                placeholder="예: 절약하는 곰돌이"
                placeholderTextColor="#9E9E9E"
                value={name}
                onChangeText={setName}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="default"
                textContentType="name"
                autoFocus={true}
                showSoftInputOnFocus={true}
                disableFullscreenUI={true}
                returnKeyType="next"
                onSubmitEditing={() => budgetInputRef.current?.focus()}
                blurOnSubmit={false}
              />
              <TouchableOpacity
                style={styles.randomBtn}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={handleGenerateRandomNickname}
              >
                <Text style={styles.randomBtnText}>🎲 랜덤 생성</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 예산 입력 */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>한 달 예상 사용 금액 (원) *필수</Text>
            <TextInput
              ref={budgetInputRef}
              style={styles.input}
              placeholder="예: 1,500,000"
              placeholderTextColor="#9E9E9E"
              keyboardType="numeric"
              value={budgetStr}
              onChangeText={(text) => setBudgetStr(formatNumberWithComma(text))}
              showSoftInputOnFocus={true}
              disableFullscreenUI={true}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
          </View>

          <TouchableOpacity style={styles.button} onPress={handleSave}>
            <Text style={styles.buttonText}>시작하기</Text>
          </TouchableOpacity>

          {/* 기존 데이터 불러오기 버튼 */}
          <TouchableOpacity
            style={styles.restoreBtn}
            activeOpacity={0.7}
            delayPressIn={0}
            onPress={() => setRestoreModalVisible(true)}
          >
            <Text style={styles.restoreBtnText}>📥 기존 백업 파일 불러오기 (복구)</Text>
          </TouchableOpacity>
        </ScrollView>
      </TouchableWithoutFeedback>

      {/* 복구 모달 */}
      <Modal
        visible={restoreModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setRestoreModalVisible(false);
          setIsRemoteInputVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>📥 백업 데이터 복구</Text>
            <Text style={styles.modalSubText}>
              원하는 복구 방식을 선택해 주세요. 원격 DB 복구는 기존에 발급받은 6자리 사용자 고유 키값을 입력하여 복원합니다.
            </Text>

            {!isRemoteInputVisible ? (
              <>
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
                  onPress={() => setIsRemoteInputVisible(true)}
                >
                  <Text style={styles.pickFileBtnText}>☁️ 원격 DB에서 복원</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.label}>사용자 고유 키값 (6자리 영문/숫자)</Text>
                <TextInput
                  style={[styles.input, { marginBottom: 12 }]}
                  placeholder="예: X8D9K1"
                  placeholderTextColor="#9E9E9E"
                  value={remoteKeyInput}
                  onChangeText={setRemoteKeyInput}
                  autoCapitalize="characters"
                  maxLength={6}
                />
                <TouchableOpacity
                  style={[styles.pickFileBtn, { backgroundColor: '#00BCD4' }]}
                  activeOpacity={0.7}
                  delayPressIn={0}
                  onPress={handleRemoteDbRestore}
                >
                  <Text style={styles.pickFileBtnText}>☁️ 입력한 키값으로 복원 실행</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#F5F5F5' }]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => {
                  if (isRemoteInputVisible) {
                    setIsRemoteInputVisible(false);
                  } else {
                    setRestoreModalVisible(false);
                  }
                }}
              >
                <Text style={{ color: '#666666', fontWeight: 'bold' }}>
                  {isRemoteInputVisible ? '뒤로가기' : '취소'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 작업 진행 프로그레스 바 모달 (0% ~ 100%) */}
      <Modal visible={isProcessing} transparent animationType="fade">
        <View style={styles.progressOverlay}>
          <View style={styles.progressCard}>
            <ActivityIndicator size="large" color="#2196F3" style={{ marginBottom: 12 }} />
            <Text style={styles.progressTitle}>작업 처리 중입니다...</Text>
            <Text style={styles.progressMsgText}>{progressMessage}</Text>

            {/* 트랙 및 100% 채움 바 */}
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            </View>

            <Text style={styles.progressPercentText}>{progressPercent}% 완료</Text>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#F8F9FA',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 32,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#424242',
    marginBottom: 8,
  },
  nicknameRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#212121',
  },
  randomBtn: {
    backgroundColor: '#E3F2FD',
    borderWidth: 1,
    borderColor: '#90CAF9',
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  randomBtnText: {
    color: '#1565C0',
    fontWeight: 'bold',
    fontSize: 13,
  },
  button: {
    backgroundColor: '#2196F3',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  restoreBtn: {
    marginTop: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF3E0',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFB74D',
  },
  restoreBtnText: {
    color: '#E65100',
    fontWeight: 'bold',
    fontSize: 13,
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
  /* 프로그레스 바 스타일 */
  progressOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  progressCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 24,
    width: '100%',
    alignItems: 'center',
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 8,
  },
  progressMsgText: {
    fontSize: 13,
    color: '#1565C0',
    textAlign: 'center',
    marginBottom: 20,
  },
  progressTrack: {
    width: '100%',
    height: 10,
    backgroundColor: '#E0E0E0',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2196F3',
  },
  progressPercentText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2196F3',
  },
});
