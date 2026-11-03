import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  DeviceEventEmitter,
  Pressable,
  PanResponder,
} from 'react-native';
import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import { Transaction } from '../types/budget';
import { transactionDao } from '../database/transactionDao';
import { recurringDao } from '../database/recurringDao';
import { getNextBusinessDay } from '../utils/dateUtils';
import { TransactionModal } from '../components/transaction/TransactionModal';

dayjs.extend(isSameOrAfter);

export const DailyDetailScreen = ({ route, navigation }: any) => {
  const initialDateStr: string = route?.params?.dateStr || dayjs().format('YYYY-MM-DD');
  const [currentDateStr, setCurrentDateStr] = useState<string>(initialDateStr);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // 원문 메세지 상세 팝업 상태
  const [rawModalVisible, setRawModalVisible] = useState(false);
  const [selectedRawTx, setSelectedRawTx] = useState<Transaction | null>(null);

  useEffect(() => {
    if (route?.params?.dateStr) {
      setCurrentDateStr(route.params.dateStr);
    }
  }, [route?.params?.dateStr]);

  // 좌우 슬라이드(스와이프) 모션 감지: 좌->우(전날), 우->좌(다음날) 이동
  const dailySwipeTriggeredRef = useRef(false);
  const dailyPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        dailySwipeTriggeredRef.current = false;
        return false;
      },
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        return (
          Math.abs(gestureState.dx) > 20 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.3
        );
      },
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return (
          Math.abs(gestureState.dx) > 20 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.3
        );
      },
      onPanResponderTerminationRequest: (_, gestureState) => {
        if (
          Math.abs(gestureState.dx) > 15 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
        ) {
          return false;
        }
        return true;
      },
      onPanResponderRelease: (_, gestureState) => {
        if (dailySwipeTriggeredRef.current) return;
        if (
          Math.abs(gestureState.dx) >= 35 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2
        ) {
          dailySwipeTriggeredRef.current = true;
          if (gestureState.dx < 0) {
            // 오른쪽에서 왼쪽으로 스와이프 (다음날 이동)
            setCurrentDateStr((prev: string) => dayjs(prev).add(1, 'day').format('YYYY-MM-DD'));
          } else {
            // 왼쪽에서 오른쪽으로 스와이프 (전날 이동)
            setCurrentDateStr((prev: string) => dayjs(prev).subtract(1, 'day').format('YYYY-MM-DD'));
          }
        }
      },
      onPanResponderTerminate: (_, gestureState) => {
        if (dailySwipeTriggeredRef.current) return;
        if (
          Math.abs(gestureState.dx) >= 35 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2
        ) {
          dailySwipeTriggeredRef.current = true;
          if (gestureState.dx < 0) {
            setCurrentDateStr((prev: string) => dayjs(prev).add(1, 'day').format('YYYY-MM-DD'));
          } else {
            setCurrentDateStr((prev: string) => dayjs(prev).subtract(1, 'day').format('YYYY-MM-DD'));
          }
        }
      },
    })
  ).current;

  const loadTransactions = useCallback(() => {
    const dbList = transactionDao.getTransactionsByDate(currentDateStr);
    const recurringRules = recurringDao.getAllRecurringRules();

    const currentMoment = dayjs(currentDateStr);
    const yearMonthStr = currentMoment.format('YYYY-MM');

    // 정기 결제/적금 항목 중 해당 날짜에 해당되는 항목 추출 (시작일 & 다중 요일 반영)
    const activeRecurringItems: Transaction[] = [];

    recurringRules.forEach((rule) => {
      const ruleStartStr = rule.startDate || '2026-01-01';
      const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');
      let appliesToThisDate = false;

      if (dayjs(currentDateStr).isSameOrAfter(dayjs(ruleStartStr), 'day')) {
        if (repeatType === 'DAILY') {
          if (rule.categoryType === 'EXPENSE') {
            const daysInMonth = currentMoment.daysInMonth();
            for (let d = 1; d <= daysInMonth; d++) {
              const rawDate = `${yearMonthStr}-${String(d).padStart(2, '0')}`;
              if (
                dayjs(rawDate).isSameOrAfter(dayjs(ruleStartStr), 'day') &&
                getNextBusinessDay(rawDate, 'EXPENSE') === currentDateStr
              ) {
                appliesToThisDate = true;
                break;
              }
            }
          } else {
            appliesToThisDate = true; // 적금은 시작일 이후 매일 당일 적용
          }
        } else if (repeatType === 'MONTHLY_DAY') {
          if (rule.dayOfMonth <= currentMoment.daysInMonth()) {
            const rawDate = `${yearMonthStr}-${String(rule.dayOfMonth).padStart(2, '0')}`;
            if (dayjs(rawDate).isSameOrAfter(dayjs(ruleStartStr), 'day')) {
              if (rule.categoryType === 'EXPENSE') {
                if (getNextBusinessDay(rawDate, 'EXPENSE') === currentDateStr) {
                  appliesToThisDate = true;
                }
              } else {
                if (rawDate === currentDateStr) {
                  appliesToThisDate = true;
                }
              }
            }
          }
        } else if (repeatType === 'WEEKLY_DAYS') {
          const daysInMonth = currentMoment.daysInMonth();
          for (let d = 1; d <= daysInMonth; d++) {
            const rawDate = `${yearMonthStr}-${String(d).padStart(2, '0')}`;
            const dayOfWeek = dayjs(rawDate).day();
            if (
              dayjs(rawDate).isSameOrAfter(dayjs(ruleStartStr), 'day') &&
              (rule.daysOfWeek || []).includes(dayOfWeek)
            ) {
              if (rule.categoryType === 'EXPENSE') {
                if (getNextBusinessDay(rawDate, 'EXPENSE') === currentDateStr) {
                  appliesToThisDate = true;
                  break;
                }
              } else {
                if (rawDate === currentDateStr) {
                  appliesToThisDate = true;
                  break;
                }
              }
            }
          }
        }
      }

      if (appliesToThisDate) {
        const alreadyInDb = dbList.some(
          (tx) => tx.merchant === rule.merchant && tx.amount === rule.amount
        );
        if (!alreadyInDb) {
          activeRecurringItems.push({
            id: `recurring_${rule.id}_${currentDateStr}`,
            date: currentDateStr,
            categoryType: rule.categoryType,
            amount: rule.amount,
            merchant: rule.merchant,
            paymentType: rule.paymentType,
            cardCompany: rule.cardCompany,
            installmentType: rule.installmentType,
            installmentMonths: 1,
            isRecurring: true,
          });
        }
      }
    });

    setTransactions([...dbList, ...activeRecurringItems]);
  }, [currentDateStr]);

  useEffect(() => {
    loadTransactions();
    const sub = DeviceEventEmitter.addListener('TRANSACTION_UPDATED', () => {
      loadTransactions();
    });
    return () => sub.remove();
  }, [loadTransactions]);

  const handleAdd = () => {
    setSelectedTx(null);
    setModalVisible(true);
  };

  const handleEdit = (tx: Transaction) => {
    setSelectedTx(tx);
    setModalVisible(true);
  };

  const handleShowRawText = (tx: Transaction) => {
    setSelectedRawTx(tx);
    setRawModalVisible(true);
  };

  const handleDelete = (id: string) => {
    if (id.startsWith('recurring_')) {
      Alert.alert('안내', '정기 결제/적금 항목은 [환경 설정 -> 정기 결제 내역 관리]에서 삭제하실 수 있습니다.');
      return;
    }
    Alert.alert('삭제 확인', '해당 거래 내역을 삭제하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          transactionDao.deleteTransaction(id);
          loadTransactions();
        },
      },
    ]);
  };

  const handleSave = (tx: Transaction) => {
    if (selectedTx && !selectedTx.id.startsWith('recurring_')) {
      transactionDao.updateTransaction(tx);
    } else {
      transactionDao.insertTransaction(tx);
    }
    loadTransactions();
  };

  // 총 지출 계산 시 할부인 경우 이번 달 분할 청구액(원금/할부개월수)으로 계산
  const totalExpense = transactions
    .filter((tx) => tx.categoryType === 'EXPENSE')
    .reduce((sum, tx) => {
      if (tx.installmentType === 'INSTALLMENT' && tx.installmentMonths > 1) {
        return sum + Math.round(tx.amount / tx.installmentMonths);
      }
      return sum + tx.amount;
    }, 0);

  const totalSavings = transactions
    .filter((tx) => tx.categoryType === 'SAVINGS')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const renderItem = ({ item }: { item: Transaction }) => {
    const isInstallment = item.installmentType === 'INSTALLMENT' && item.installmentMonths > 1;
    const monthlyInstallmentAmount = isInstallment ? Math.round(item.amount / item.installmentMonths) : item.amount;

    return (
      <Pressable
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
        onPress={() => handleShowRawText(item)}
      >
        <View style={styles.cardHeader}>
          <View style={styles.badgeRow}>
            <Text
              style={[
                styles.categoryBadge,
                item.categoryType === 'EXPENSE'
                  ? styles.expenseBadge
                  : styles.savingsBadge,
              ]}
            >
              {item.categoryType === 'EXPENSE' ? '지출' : '적금'}
            </Text>
            <Text style={styles.merchantText}>{item.merchant}</Text>
          </View>

          <Text style={styles.amountText}>
            {monthlyInstallmentAmount.toLocaleString()} 원
          </Text>
        </View>

        <View style={styles.cardDetail}>
          <Text style={styles.metaText}>
            {item.paymentType === 'CARD'
              ? `💳 ${item.cardCompany || '카드'}`
              : '💵 현금'}{' '}
            |{' '}
            {isInstallment
              ? `${item.installmentMonths}개월 할부 (할부 원금 ${item.amount.toLocaleString()}원)`
              : '일시불'}
            {item.isRecurring ? ' (정기결제)' : ''}
          </Text>

          {!item.id.startsWith('recurring_') ? (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.editBtn}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => handleEdit(item)}
              >
                <Text style={styles.btnText}>수정</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteBtn}
                activeOpacity={0.7}
                delayPressIn={0}
                onPress={() => handleDelete(item.id)}
              >
                <Text style={styles.deleteBtnText}>삭제</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.recurringNoticeBadge}>
              <Text style={styles.recurringNoticeText}>자동 정기 항목</Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container} {...dailyPanResponder.panHandlers}>
      {/* 일별 통합 배너 및 날짜 이동 컨트롤러 */}
      <View style={styles.summaryBanner}>
        <View style={styles.dateHeaderRow}>
          <TouchableOpacity
            style={styles.dayNavBtn}
            onPress={() => setCurrentDateStr(dayjs(currentDateStr).subtract(1, 'day').format('YYYY-MM-DD'))}
          >
            <Text style={styles.dayNavBtnText}>◀ 전날</Text>
          </TouchableOpacity>

          <Text style={styles.dateTitle}>{currentDateStr} 거래 내역</Text>

          <TouchableOpacity
            style={styles.dayNavBtn}
            onPress={() => setCurrentDateStr(dayjs(currentDateStr).add(1, 'day').format('YYYY-MM-DD'))}
          >
            <Text style={styles.dayNavBtnText}>다음날 ▶</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryExpense}>
            총 지출: {totalExpense.toLocaleString()}원
          </Text>
          <Text style={styles.summarySavings}>
            총 적금: {totalSavings.toLocaleString()}원
          </Text>
        </View>
      </View>

      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>등록된 거래 내역이 없습니다.</Text>
            <Text style={styles.swipeGuideText}>💡 화면을 좌우로 스와이프하여 전날/다음날로 바로 이동하실 수 있습니다.</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.7}
        delayPressIn={0}
        onPress={handleAdd}
      >
        <Text style={styles.fabText}>+ 거래 추가</Text>
      </TouchableOpacity>

      <TransactionModal
        visible={modalVisible}
        dateStr={currentDateStr}
        initialData={selectedTx}
        onClose={() => setModalVisible(false)}
        onSave={handleSave}
      />

      {/* 수신된 결제 문자 / App Push 원문 메세지 상세 팝업 */}
      <Modal
        visible={rawModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRawModalVisible(false)}
      >
        <View style={styles.rawModalOverlay}>
          <View style={styles.rawModalContainer}>
            <Text style={styles.rawModalTitle}>💳 거래 수신 원문 메세지 내용</Text>

            {selectedRawTx && (
              <View style={styles.rawModalContent}>
                <Text style={styles.rawMetaLabel}>사용처 / 가맹점: <Text style={styles.rawMetaValue}>{selectedRawTx.merchant}</Text></Text>
                <Text style={styles.rawMetaLabel}>결제 금액: <Text style={styles.rawMetaValue}>{selectedRawTx.amount.toLocaleString()}원</Text></Text>
                <Text style={styles.rawMetaLabel}>결제 일시: <Text style={styles.rawMetaValue}>{selectedRawTx.createdAt || selectedRawTx.date}</Text></Text>
                <Text style={styles.rawMetaLabel}>결제 수단: <Text style={styles.rawMetaValue}>{selectedRawTx.paymentType === 'CARD' ? selectedRawTx.cardCompany || '카드' : '현금'}</Text></Text>
                <Text style={styles.rawMetaLabel}>할부 정보: <Text style={styles.rawMetaValue}>{selectedRawTx.installmentType === 'INSTALLMENT' ? `${selectedRawTx.installmentMonths}개월 할부` : '일시불'}</Text></Text>

                <Text style={styles.rawBoxTitle}>📱 수신된 원문 문자/푸시 내용:</Text>
                <View style={styles.rawTextBox}>
                  <Text style={styles.rawTextContent}>
                    {selectedRawTx.isRecurring
                      ? '[정기 결제/적금] 시스템에 설정된 자동 정기 규칙에 의해 등록된 항목입니다.'
                      : `[승인 알림]\n일시: ${selectedRawTx.createdAt || selectedRawTx.date}\n카드사: ${selectedRawTx.cardCompany || '카드'}\n가맹점: ${selectedRawTx.merchant}\n금액: ${selectedRawTx.amount.toLocaleString()}원\n할부: ${selectedRawTx.installmentType === 'INSTALLMENT' ? `${selectedRawTx.installmentMonths}개월` : '일시불'}`}
                  </Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={styles.rawCloseBtn}
              activeOpacity={0.7}
              delayPressIn={0}
              onPress={() => setRawModalVisible(false)}
            >
              <Text style={styles.rawCloseBtnText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  summaryBanner: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  dateHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dayNavBtn: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  dayNavBtnText: {
    fontSize: 12,
    color: '#1976D2',
    fontWeight: 'bold',
  },
  dateTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryExpense: {
    fontSize: 14,
    color: '#D32F2F',
    fontWeight: '600',
  },
  summarySavings: {
    fontSize: 14,
    color: '#1976D2',
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 80,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryBadge: {
    fontSize: 11,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  expenseBadge: {
    backgroundColor: '#FFEBEE',
    color: '#C62828',
  },
  savingsBadge: {
    backgroundColor: '#E3F2FD',
    color: '#1565C0',
  },
  merchantText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#212121',
  },
  amountText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#212121',
  },
  cardDetail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#FAFAFA',
  },
  metaText: {
    fontSize: 12,
    color: '#757575',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  editBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
  },
  btnText: {
    fontSize: 12,
    color: '#424242',
  },
  deleteBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FFEBEE',
    borderRadius: 4,
  },
  deleteBtnText: {
    fontSize: 12,
    color: '#D32F2F',
  },
  recurringNoticeBadge: {
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  recurringNoticeText: {
    fontSize: 11,
    color: '#F57F17',
    fontWeight: '600',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#9E9E9E',
    fontSize: 14,
  },
  swipeGuideText: {
    color: '#1565C0',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    backgroundColor: '#2196F3',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    elevation: 4,
  },
  fabText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 15,
  },
  /* 원문 상세 모달 스타일 */
  rawModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  rawModalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 18,
    maxHeight: '80%',
  },
  rawModalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 14,
  },
  rawModalContent: {
    gap: 6,
  },
  rawMetaLabel: {
    fontSize: 13,
    color: '#666666',
  },
  rawMetaValue: {
    fontWeight: 'bold',
    color: '#212121',
  },
  rawBoxTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1565C0',
    marginTop: 10,
  },
  rawTextBox: {
    backgroundColor: '#263238',
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
  },
  rawTextContent: {
    color: '#80CBC4',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  rawCloseBtn: {
    marginTop: 16,
    backgroundColor: '#2196F3',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  rawCloseBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
