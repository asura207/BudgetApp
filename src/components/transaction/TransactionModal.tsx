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
import {
  Transaction,
  CategoryType,
  PaymentType,
  InstallmentType,
} from '../../types/budget';
import { formatNumberWithComma, parseNumberFromComma } from '../../utils/budgetUtils';

interface TransactionModalProps {
  visible: boolean;
  dateStr: string;
  initialData?: Transaction | null;
  onClose: () => void;
  onSave: (tx: Transaction) => void;
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

export const TransactionModal: React.FC<TransactionModalProps> = ({
  visible,
  dateStr,
  initialData,
  onClose,
  onSave,
}) => {
  const [categoryType, setCategoryType] = useState<CategoryType>('EXPENSE');
  const [amountStr, setAmountStr] = useState('');
  const [isCancellation, setIsCancellation] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [paymentType, setPaymentType] = useState<PaymentType>('CARD');
  const [cardCompany, setCardCompany] = useState('신한카드');
  const [customCardCompany, setCustomCardCompany] = useState('');
  const [installmentType, setInstallmentType] = useState<InstallmentType>('LUMP_SUM');
  const [installmentMonths, setInstallmentMonths] = useState('1');

  const [selectBoxVisible, setSelectBoxVisible] = useState(false);

  useEffect(() => {
    if (initialData) {
      setCategoryType(initialData.categoryType);
      setIsCancellation(initialData.amount < 0);
      setAmountStr(formatNumberWithComma(Math.abs(initialData.amount)));
      setMerchant(initialData.merchant);
      setPaymentType(initialData.paymentType);

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
      setInstallmentMonths(String(initialData.installmentMonths || 1));
    } else {
      setCategoryType('EXPENSE');
      setIsCancellation(false);
      setAmountStr('');
      setMerchant('');
      setPaymentType('CARD');
      setCardCompany('신한카드');
      setCustomCardCompany('');
      setInstallmentType('LUMP_SUM');
      setInstallmentMonths('1');
    }
  }, [initialData, visible]);

  const handlePaymentTypeChange = (type: PaymentType) => {
    setPaymentType(type);
    if (type === 'CASH') {
      setInstallmentType('LUMP_SUM');
      setInstallmentMonths('1');
    }
  };

  const handleSave = () => {
    const amount = parseNumberFromComma(amountStr);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('알림', '유효한 금액을 입력해 주세요.');
      return;
    }

    if (!merchant.trim()) {
      Alert.alert('알림', '사용처를 입력해 주세요.');
      return;
    }

    const months = parseInt(installmentMonths, 10) || 1;
    const finalCardCompany =
      paymentType === 'CARD'
        ? cardCompany === '기타'
          ? customCardCompany.trim() || '기타카드'
          : cardCompany
        : undefined;

    const tx: Transaction = {
      id: initialData ? initialData.id : String(Date.now()),
      date: dateStr,
      categoryType,
      amount: isCancellation ? -Math.abs(amount) : amount,
      merchant: merchant.trim(),
      paymentType,
      cardCompany: finalCardCompany,
      installmentType: paymentType === 'CASH' ? 'LUMP_SUM' : installmentType,
      installmentMonths: paymentType === 'CASH' || installmentType === 'LUMP_SUM' ? 1 : months,
      isRecurring: initialData ? initialData.isRecurring : false,
    };

    onSave(tx);
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
              {initialData ? '거래 내역 수정' : '거래 내역 추가'} ({dateStr})
            </Text>

            {/* 구분 선택 (지출 / 적금) */}
            <View style={styles.row}>
              <TouchableOpacity
                style={[
                  styles.optionBtn,
                  categoryType === 'EXPENSE' && styles.selectedOptionBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => setCategoryType('EXPENSE')}
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
                onPress={() => setCategoryType('SAVINGS')}
              >
                <Text
                  style={[
                    styles.optionText,
                    categoryType === 'SAVINGS' && styles.selectedOptionText,
                  ]}
                >
                  🏦 적금/저축
                </Text>
              </TouchableOpacity>
            </View>

            {/* 사용처 */}
            <Text style={styles.label}>사용처</Text>
            <TextInput
              style={styles.input}
              placeholder="예: 스타벅스, 청약저축"
              value={merchant}
              onChangeText={setMerchant}
              autoCapitalize="none"
              autoCorrect={false}
              disableFullscreenUI={true}
            />

            {/* 금액 */}
            <Text style={styles.label}>금액 (원)</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[
                  styles.optionBtn,
                  !isCancellation && styles.selectedOptionBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => setIsCancellation(false)}
              >
                <Text
                  style={[
                    styles.optionText,
                    !isCancellation && styles.selectedOptionText,
                  ]}
                >
                  정상 결제 (+)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.optionBtn,
                  isCancellation && styles.selectedOptionBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => setIsCancellation(true)}
              >
                <Text
                  style={[
                    styles.optionText,
                    isCancellation && styles.selectedOptionText,
                  ]}
                >
                  취소 / 차감 (-)
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="0"
              keyboardType="numeric"
              value={amountStr}
              onChangeText={(text) => setAmountStr(formatNumberWithComma(text))}
              autoCapitalize="none"
              autoCorrect={false}
              disableFullscreenUI={true}
            />

            {/* 지불 유형 (카드 / 현금) */}
            <Text style={styles.label}>지불 유형</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[
                  styles.optionBtn,
                  paymentType === 'CARD' && styles.selectedOptionBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => handlePaymentTypeChange('CARD')}
              >
                <Text
                  style={[
                    styles.optionText,
                    paymentType === 'CARD' && styles.selectedOptionText,
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

            {/* 카드사 Select Box 영역 (지불 유형이 '카드'일 때) */}
            {paymentType === 'CARD' && (
              <View style={styles.cardCompanySection}>
                <Text style={styles.label}>카드사 선택</Text>

                <TouchableOpacity
                  style={styles.selectBox}
                  activeOpacity={0.7}
                  delayPressIn={0}
                  onPress={() => setSelectBoxVisible(true)}
                >
                  <Text style={styles.selectBoxText}>💳 {cardCompany}</Text>
                  <Text style={styles.selectBoxArrow}>▼</Text>
                </TouchableOpacity>

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

            {/* 할부 여부 (현금 시 고정) */}
            <Text style={styles.label}>할부 여부</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[
                  styles.optionBtn,
                  installmentType === 'LUMP_SUM' && styles.selectedOptionBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => setInstallmentType('LUMP_SUM')}
              >
                <Text
                  style={[
                    styles.optionText,
                    installmentType === 'LUMP_SUM' && styles.selectedOptionText,
                  ]}
                >
                  일시불
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.optionBtn,
                  installmentType === 'INSTALLMENT' && styles.selectedOptionBtn,
                  paymentType === 'CASH' && styles.disabledBtn,
                ]}
                activeOpacity={0.7}
                delayPressIn={0}
                disabled={paymentType === 'CASH'}
                onPress={() => setInstallmentType('INSTALLMENT')}
              >
                <Text
                  style={[
                    styles.optionText,
                    installmentType === 'INSTALLMENT' && styles.selectedOptionText,
                    paymentType === 'CASH' && styles.disabledText,
                  ]}
                >
                  할부
                </Text>
              </TouchableOpacity>
            </View>

            {paymentType === 'CASH' && (
              <Text style={styles.noticeText}>
                ※ 현금 결제 시 할부여부는 '일시불'로 고정됩니다.
              </Text>
            )}

            {paymentType === 'CARD' && installmentType === 'INSTALLMENT' && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.label}>할부 개월 수</Text>
                <TextInput
                  style={styles.input}
                  placeholder="3"
                  keyboardType="numeric"
                  value={installmentMonths}
                  onChangeText={setInstallmentMonths}
                  autoCapitalize="none"
                  autoCorrect={false}
                  disableFullscreenUI={true}
                />
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

        {/* 카드사 Select Box 드롭다운 모달 */}
        <Modal
          visible={selectBoxVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectBoxVisible(false)}
        >
          <TouchableOpacity
            style={styles.selectModalOverlay}
            activeOpacity={1}
            onPress={() => setSelectBoxVisible(false)}
          >
            <View style={styles.selectModalContainer}>
              <Text style={styles.selectModalTitle}>카드사 선택</Text>
              <ScrollView style={{ maxHeight: 320 }}>
                {CARD_COMPANIES.map((company) => (
                  <TouchableOpacity
                    key={company}
                    style={[
                      styles.selectItem,
                      cardCompany === company && styles.selectedSelectItem,
                    ]}
                    activeOpacity={0.7}
                    delayPressIn={0}
                    onPress={() => {
                      setCardCompany(company);
                      setSelectBoxVisible(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.selectItemText,
                        cardCompany === company && styles.selectedSelectItemText,
                      ]}
                    >
                      {company}
                    </Text>
                    {cardCompany === company && (
                      <Text style={styles.checkMark}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
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
    fontSize: 14,
    color: '#666666',
  },
  selectedOptionText: {
    color: '#1976D2',
    fontWeight: 'bold',
  },
  cardCompanySection: {
    marginTop: 4,
  },
  selectBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2196F3',
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
  selectBoxText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1565C0',
  },
  selectBoxArrow: {
    fontSize: 12,
    color: '#1565C0',
  },
  disabledText: {
    color: '#BDBDBD',
  },
  noticeText: {
    fontSize: 12,
    color: '#E65100',
    marginTop: 6,
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
  /* Select Box 드롭다운 모달 */
  selectModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 30,
  },
  selectModalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    elevation: 5,
  },
  selectModalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 12,
    textAlign: 'center',
  },
  selectItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  selectedSelectItem: {
    backgroundColor: '#E3F2FD',
  },
  selectItemText: {
    fontSize: 14,
    color: '#424242',
  },
  selectedSelectItemText: {
    fontWeight: 'bold',
    color: '#1976D2',
  },
  checkMark: {
    color: '#1976D2',
    fontWeight: 'bold',
  },
});
