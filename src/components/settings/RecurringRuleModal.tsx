import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import dayjs from 'dayjs';
import {
  RecurringRule,
  CategoryType,
  PaymentType,
  InstallmentType,
  RepeatType,
} from '../../types/budget';
import { formatNumberWithComma, parseNumberFromComma } from '../../utils/budgetUtils';

interface RecurringRuleModalProps {
  visible: boolean;
  initialData?: RecurringRule | null;
  onClose: () => void;
  onSave: (rule: RecurringRule) => void;
}

const CARD_COMPANIES = [
  '신한카드',
  '국민카드',
  '현대카드',
  '삼성카드',
  '롯데카드',
  '하나카드',
  '우리카드',
  'NH농협카드',
  '카카오뱅크',
  '기타',
];

const DAYS_OF_WEEK_OPTIONS = [
  { id: 1, label: '월' },
  { id: 2, label: '화' },
  { id: 3, label: '수' },
  { id: 4, label: '목' },
  { id: 5, label: '금' },
  { id: 6, label: '토' },
  { id: 0, label: '일' },
];

export const RecurringRuleModal: React.FC<RecurringRuleModalProps> = ({
  visible,
  initialData,
  onClose,
  onSave,
}) => {
  const todayStr = dayjs().format('YYYY-MM-DD');

  const [startDate, setStartDate] = useState(todayStr);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [repeatType, setRepeatType] = useState<RepeatType>('MONTHLY_DAY');
  const [selectedDaysOfWeek, setSelectedDaysOfWeek] = useState<number[]>([1, 2, 3, 4]); // 기본값 월~목
  const [dayStr, setDayStr] = useState('1');
  const [categoryType, setCategoryType] = useState<CategoryType>('EXPENSE');
  const [amountStr, setAmountStr] = useState('');
  const [merchant, setMerchant] = useState('');
  const [paymentType, setPaymentType] = useState<PaymentType>('CARD');
  const [cardCompany, setCardCompany] = useState('신한카드');
  const [customCardCompany, setCustomCardCompany] = useState('');
  const [installmentType, setInstallmentType] = useState<InstallmentType>('LUMP_SUM');

  useEffect(() => {
    if (initialData) {
      setStartDate(initialData.startDate || todayStr);
      setRepeatType(initialData.repeatType || (initialData.isDaily ? 'DAILY' : 'MONTHLY_DAY'));
      setSelectedDaysOfWeek(initialData.daysOfWeek && initialData.daysOfWeek.length > 0 ? initialData.daysOfWeek : [1, 2, 3, 4]);
      setDayStr(String(initialData.dayOfMonth || 1));
      setCategoryType(initialData.categoryType);
      setAmountStr(formatNumberWithComma(initialData.amount));
      setMerchant(initialData.merchant);
      setPaymentType(initialData.categoryType === 'SAVINGS' ? 'CASH' : initialData.paymentType);

      if (initialData.cardCompany) {
        if (CARD_COMPANIES.includes(initialData.cardCompany)) {
          setCardCompany(initialData.cardCompany);
          setCustomCardCompany('');
        } else {
          setCardCompany('기타');
          setCustomCardCompany(initialData.cardCompany);
        }
      } else {
        setCardCompany('신한카드');
        setCustomCardCompany('');
      }

      setInstallmentType(initialData.installmentType);
    } else {
      setStartDate(todayStr);
      setRepeatType('MONTHLY_DAY');
      setSelectedDaysOfWeek([1, 2, 3, 4]);
      setDayStr('1');
      setCategoryType('EXPENSE');
      setAmountStr('');
      setMerchant('');
      setPaymentType('CARD');
      setCardCompany('신한카드');
      setCustomCardCompany('');
      setInstallmentType('LUMP_SUM');
    }
  }, [initialData, visible]);

  const toggleDayOfWeek = (dayId: number) => {
    if (selectedDaysOfWeek.includes(dayId)) {
      setSelectedDaysOfWeek(selectedDaysOfWeek.filter((d) => d !== dayId));
    } else {
      setSelectedDaysOfWeek([...selectedDaysOfWeek, dayId].sort((a, b) => a - b));
    }
  };

  const handleCategoryTypeChange = (cat: CategoryType) => {
    setCategoryType(cat);
    if (cat === 'SAVINGS') {
      setPaymentType('CASH');
      setInstallmentType('LUMP_SUM');
    }
  };

  const handlePaymentTypeChange = (type: PaymentType) => {
    if (categoryType === 'SAVINGS') return; // 적금 시 현금 고정
    setPaymentType(type);
    if (type === 'CASH') {
      setInstallmentType('LUMP_SUM');
    }
  };

  const handleSave = () => {
    const dayOfMonth = parseInt(dayStr, 10);
    if (repeatType === 'MONTHLY_DAY' && (isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) {
      Alert.alert('알림', '유효한 지정일(1~31)을 입력해 주세요.');
      return;
    }

    if (repeatType === 'WEEKLY_DAYS' && selectedDaysOfWeek.length === 0) {
      Alert.alert('알림', '최소 하나 이상의 요일을 선택해 주세요.');
      return;
    }

    const amount = parseNumberFromComma(amountStr);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('알림', '유효한 금액을 입력해 주세요.');
      return;
    }

    if (!merchant.trim()) {
      Alert.alert('알림', '사용처를 입력해 주세요.');
      return;
    }

    const finalPaymentType = categoryType === 'SAVINGS' ? 'CASH' : paymentType;
    const finalCardCompany =
      finalPaymentType === 'CARD'
        ? cardCompany === '기타'
          ? customCardCompany.trim() || '기타카드'
          : cardCompany
        : undefined;

    const rule: RecurringRule = {
      id: initialData ? initialData.id : String(Date.now()),
      dayOfMonth: repeatType === 'MONTHLY_DAY' ? dayOfMonth : 1,
      isDaily: repeatType === 'DAILY',
      repeatType,
      daysOfWeek: repeatType === 'WEEKLY_DAYS' ? selectedDaysOfWeek : [],
      startDate,
      categoryType,
      amount,
      merchant: merchant.trim(),
      paymentType: finalPaymentType,
      cardCompany: finalCardCompany,
      installmentType: finalPaymentType === 'CASH' ? 'LUMP_SUM' : installmentType,
    };

    onSave(rule);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.contentContainer}>
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="always"
          >
            <Text style={styles.title}>
              {initialData ? '정기 결제/적금 수정' : '정기 결제/적금 등록'}
            </Text>

            {/* 시작일 선택 */}
            <Text style={styles.label}>시작일 설정</Text>
            <TouchableOpacity
              style={styles.startDateBtn}
              activeOpacity={0.7}
              delayPressIn={0}
              onPress={() => setCalendarVisible(true)}
            >
              <Text style={styles.startDateBtnText}>📅 시작일: {startDate} (터치하여 변경)</Text>
            </TouchableOpacity>

            {/* 반복 주기 선택: 매월 지정일 vs 매일 반복 vs 특정 요일 선택 */}
            <Text style={styles.label}>반복 주기 설정</Text>
            <View style={styles.repeatTypeContainer}>
              <TouchableOpacity
                style={[
                  styles.repeatTypeBtn,
                  repeatType === 'MONTHLY_DAY' && styles.selectedOptionBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => setRepeatType('MONTHLY_DAY')}
              >
                <Text
                  style={[
                    styles.optionText,
                    repeatType === 'MONTHLY_DAY' && styles.selectedOptionText,
                  ]}
                >
                  📅 매월 지정일
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.repeatTypeBtn,
                  repeatType === 'DAILY' && styles.selectedOptionBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => setRepeatType('DAILY')}
              >
                <Text
                  style={[
                    styles.optionText,
                    repeatType === 'DAILY' && styles.selectedOptionText,
                  ]}
                >
                  🔁 매일 반복
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.repeatTypeBtn,
                  repeatType === 'WEEKLY_DAYS' && styles.selectedOptionBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => setRepeatType('WEEKLY_DAYS')}
              >
                <Text
                  style={[
                    styles.optionText,
                    repeatType === 'WEEKLY_DAYS' && styles.selectedOptionText,
                  ]}
                >
                  🗓️ 특정 요일
                </Text>
              </TouchableOpacity>
            </View>

            {/* 조건별 서브 설정 */}
            {repeatType === 'MONTHLY_DAY' && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>매월 지정일 (1 ~ 31일)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="15"
                  keyboardType="numeric"
                  value={dayStr}
                  onChangeText={setDayStr}
                  autoCapitalize="none"
                  autoCorrect={false}
                  disableFullscreenUI={true}
                />
              </View>
            )}

            {repeatType === 'DAILY' && (
              <View style={styles.dailyNoticeBox}>
                <Text style={styles.dailyNoticeText}>
                  ※ '매일' 선택 시 시작일부터 매일 설정된 금액이 자동으로 반영됩니다.
                </Text>
              </View>
            )}

            {repeatType === 'WEEKLY_DAYS' && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>반복 요일 다중 선택 (터치하여 선택/해제)</Text>
                <View style={styles.dayOfWeekRow}>
                  {DAYS_OF_WEEK_OPTIONS.map((item) => {
                    const isSelected = selectedDaysOfWeek.includes(item.id);
                    return (
                      <TouchableOpacity
                        key={item.id}
                        activeOpacity={0.7}
                        delayPressIn={0}
                        style={[
                          styles.dayOfWeekChip,
                          isSelected && styles.selectedDayOfWeekChip,
                        ]}
                        onPress={() => toggleDayOfWeek(item.id)}
                      >
                        <Text
                          style={[
                            styles.dayOfWeekChipText,
                            isSelected && styles.selectedDayOfWeekChipText,
                          ]}
                        >
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.dailyNoticeBox}>
                  <Text style={styles.dailyNoticeText}>
                    ※ 선택한 요일(토·일 포함)은 주말/공휴일 이관 없이 해당 요일에 그대로 표시됩니다.
                  </Text>
                </View>
              </View>
            )}

            {/* 구분 */}
            <Text style={styles.label}>구분</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[
                  styles.optionBtn,
                  categoryType === 'EXPENSE' && styles.selectedOptionBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => handleCategoryTypeChange('EXPENSE')}
              >
                <Text
                  style={[
                    styles.optionText,
                    categoryType === 'EXPENSE' && styles.selectedOptionText,
                  ]}
                >
                  💸 지출
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.optionBtn,
                  categoryType === 'SAVINGS' && styles.selectedOptionBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => handleCategoryTypeChange('SAVINGS')}
              >
                <Text
                  style={[
                    styles.optionText,
                    categoryType === 'SAVINGS' && styles.selectedOptionText,
                  ]}
                >
                  🏦 적금
                </Text>
              </TouchableOpacity>
            </View>

            {/* 사용처 */}
            <Text style={styles.label}>사용처</Text>
            <TextInput
              style={styles.input}
              placeholder="예: 넷플릭스, 주택청약"
              value={merchant}
              onChangeText={setMerchant}
              autoCapitalize="none"
              autoCorrect={false}
              disableFullscreenUI={true}
            />

            {/* 금액 */}
            <Text style={styles.label}>금액 (원)</Text>
            <TextInput
              style={styles.input}
              placeholder="17,000"
              keyboardType="numeric"
              value={amountStr}
              onChangeText={(text) => setAmountStr(formatNumberWithComma(text))}
              autoCapitalize="none"
              autoCorrect={false}
              disableFullscreenUI={true}
            />

            {/* 지불 유형 */}
            <Text style={styles.label}>지불 유형</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[
                  styles.optionBtn,
                  paymentType === 'CARD' && styles.selectedOptionBtn,
                  categoryType === 'SAVINGS' && styles.disabledBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                disabled={categoryType === 'SAVINGS'}
                onPress={() => handlePaymentTypeChange('CARD')}
              >
                <Text
                  style={[
                    styles.optionText,
                    paymentType === 'CARD' && styles.selectedOptionText,
                    categoryType === 'SAVINGS' && styles.disabledText,
                  ]}
                >
                  💳 카드
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.optionBtn,
                  paymentType === 'CASH' && styles.selectedOptionBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => handlePaymentTypeChange('CASH')}
              >
                <Text
                  style={[
                    styles.optionText,
                    paymentType === 'CASH' && styles.selectedOptionText,
                  ]}
                >
                  💵 현금
                </Text>
              </TouchableOpacity>
            </View>

            {categoryType === 'SAVINGS' && (
              <Text style={styles.savingsNoticeText}>
                ※ 적금 선택 시 지불 유형은 '현금'으로 고정됩니다.
              </Text>
            )}

            {/* 카드사 선택 영역 (지불 유형이 '카드'일 때) */}
            {paymentType === 'CARD' && categoryType !== 'SAVINGS' && (
              <View style={styles.cardCompanySection}>
                <Text style={styles.label}>카드사 선택</Text>
                <View style={styles.chipContainer}>
                  {CARD_COMPANIES.map((company) => (
                    <TouchableOpacity
                      key={company}
                      activeOpacity={0.7}
                      delayPressIn={0}
                      style={[
                        styles.chip,
                        cardCompany === company && styles.selectedChip,
                      ]}
                      onPress={() => setCardCompany(company)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          cardCompany === company && styles.selectedChipText,
                        ]}
                      >
                        {company}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {cardCompany === '기타' && (
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    placeholder="직접 카드사 명칭 입력 (예: 카카오뱅크)"
                    value={customCardCompany}
                    onChangeText={setCustomCardCompany}
                    autoCapitalize="none"
                    autoCorrect={false}
                    disableFullscreenUI={true}
                  />
                )}
              </View>
            )}

            {/* 하단 버튼 */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.cancelBtn]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={onClose}
              >
                <Text style={styles.cancelBtnText}>취소</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.saveBtn]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={handleSave}
              >
                <Text style={styles.saveBtnText}>저장</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>

        {/* 시작일 선택 달력 모달 */}
        <Modal
          visible={calendarVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setCalendarVisible(false)}
        >
          <View style={styles.calendarOverlay}>
            <View style={styles.calendarContainer}>
              <Text style={styles.calendarTitle}>정기 시작일 선택</Text>
              <Calendar
                current={startDate || todayStr}
                markedDates={{
                  [startDate]: {
                    selected: true,
                    selectedColor: '#2196F3',
                  },
                }}
                onDayPress={(day: any) => {
                  setStartDate(day.dateString);
                  setCalendarVisible(false);
                }}
                theme={{
                  todayTextColor: '#2196F3',
                  arrowColor: '#2196F3',
                }}
              />
              <TouchableOpacity
                style={[styles.cancelBtn, { marginTop: 12, alignSelf: 'flex-end', paddingHorizontal: 16 }]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => setCalendarVisible(false)}
              >
                <Text style={styles.cancelBtnText}>닫기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  contentContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  scrollArea: {
    flexGrow: 0,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#212121',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666666',
    marginTop: 14,
    marginBottom: 6,
  },
  startDateBtn: {
    borderWidth: 1,
    borderColor: '#2196F3',
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 2,
  },
  startDateBtnText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1565C0',
  },
  repeatTypeContainer: {
    flexDirection: 'row',
    gap: 6,
  },
  repeatTypeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    alignItems: 'center',
  },
  dayOfWeekRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  dayOfWeekChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    alignItems: 'center',
  },
  selectedDayOfWeekChip: {
    backgroundColor: '#E3F2FD',
    borderColor: '#2196F3',
  },
  dayOfWeekChipText: {
    fontSize: 13,
    color: '#616161',
  },
  selectedDayOfWeekChipText: {
    color: '#1976D2',
    fontWeight: 'bold',
  },
  inputGroup: {
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#212121',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  optionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    alignItems: 'center',
  },
  selectedOptionBtn: {
    backgroundColor: '#E3F2FD',
    borderColor: '#2196F3',
  },
  disabledBtn: {
    backgroundColor: '#F5F5F5',
    borderColor: '#EEEEEE',
  },
  optionText: {
    fontSize: 12,
    color: '#666666',
  },
  selectedOptionText: {
    color: '#1976D2',
    fontWeight: 'bold',
  },
  disabledText: {
    color: '#BDBDBD',
  },
  dailyNoticeBox: {
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  dailyNoticeText: {
    fontSize: 12,
    color: '#F57F17',
    fontWeight: '500',
  },
  savingsNoticeText: {
    fontSize: 12,
    color: '#1565C0',
    marginTop: 6,
  },
  cardCompanySection: {
    marginTop: 4,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  selectedChip: {
    backgroundColor: '#E8F5E9',
    borderColor: '#4CAF50',
  },
  chipText: {
    fontSize: 12,
    color: '#616161',
  },
  selectedChipText: {
    color: '#2E7D32',
    fontWeight: 'bold',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: '#F5F5F5',
  },
  saveBtn: {
    backgroundColor: '#2196F3',
  },
  cancelBtnText: {
    color: '#666666',
    fontWeight: 'bold',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  calendarOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  calendarContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    elevation: 5,
  },
  calendarTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 12,
  },
});
