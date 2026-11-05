import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ScrollView, Pressable, TextInput, Alert, DeviceEventEmitter, PanResponder } from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { useFocusEffect } from '@react-navigation/native';
import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import { BudgetHeaderBanner } from '../components/calendar/BudgetHeaderBanner';
import { ViewMode } from '../types/budget';
import {
  getMonthlyBudget,
  getViewMode,
  setViewMode as setStorageViewMode,
  getManualInstallment,
  setManualInstallment,
} from '../storage/mmkv';
import { transactionDao } from '../database/transactionDao';
import { recurringDao } from '../database/recurringDao';
import { getNextBusinessDay, isRedDay } from '../utils/dateUtils';
import {
  calculateDailyBudget,
  getBudgetStatusColor,
  calculateWeeklyRemainingBudget,
  formatNumberWithComma,
  parseNumberFromComma,
} from '../utils/budgetUtils';
import {
  InstallmentDetailModal,
  InstallmentItemDetail,
} from '../components/calendar/InstallmentDetailModal';

dayjs.extend(isSameOrAfter);

LocaleConfig.locales['kr'] = {
  monthNames: [
    '1월',
    '2월',
    '3월',
    '4월',
    '5월',
    '6월',
    '7월',
    '8월',
    '9월',
    '10월',
    '11월',
    '12월',
  ],
  monthNamesShort: [
    '1월',
    '2월',
    '3월',
    '4월',
    '5월',
    '6월',
    '7월',
    '8월',
    '9월',
    '10월',
    '11월',
    '12월',
  ],
  dayNames: [
    '일요일',
    '월요일',
    '화요일',
    '수요일',
    '목요일',
    '금요일',
    '토요일',
  ],
  dayNamesShort: ['일', '월', '화', '수', '목', '금', '토'],
  today: '오늘',
};
LocaleConfig.defaultLocale = 'kr';

interface MainCalendarScreenProps {
  onSelectDate: (dateStr: string) => void;
  onOpenSettings?: () => void;
}

export const MainCalendarScreen: React.FC<MainCalendarScreenProps> = ({
  onSelectDate,
}) => {
  const [currentYearMonth, setCurrentYearMonth] = useState(
    dayjs().format('YYYY-MM')
  );
  const [viewMode, setMode] = useState<ViewMode>(getViewMode());
  const [dailyExpenseTotals, setDailyExpenseTotals] = useState<{ [date: string]: number }>({});
  const [dailySavingsTotals, setDailySavingsTotals] = useState<{ [date: string]: number }>({});
  const [thisMonthInstallmentTotal, setThisMonthInstallmentTotal] = useState<number>(0);
  const [manualInstallmentStr, setManualInstallmentStr] = useState('');
  const [installmentModalVisible, setInstallmentModalVisible] = useState(false);
  const [installmentDetailItems, setInstallmentDetailItems] = useState<InstallmentItemDetail[]>([]);

  const [monthlyBudget, setBudget] = useState(getMonthlyBudget(currentYearMonth));

  // 주간 뷰를 위한 선택된 주 기준 날짜
  const [selectedWeekDate, setSelectedWeekDate] = useState(dayjs());

  // 월간 뷰 전용 좌우 스와이프 제스처 (좌->우: 지난달, 우->좌: 다음달 이동)
  const monthlySwipeTriggeredRef = useRef(false);
  const monthlyPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        monthlySwipeTriggeredRef.current = false;
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
        if (monthlySwipeTriggeredRef.current) return;
        if (
          Math.abs(gestureState.dx) >= 35 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2
        ) {
          monthlySwipeTriggeredRef.current = true;
          if (gestureState.dx < 0) {
            // 오른쪽에서 왼쪽으로 스와이프 (다음 달)
            setCurrentYearMonth((prev) =>
              dayjs(`${prev}-01`, 'YYYY-MM-DD').add(1, 'month').format('YYYY-MM')
            );
          } else {
            // 왼쪽에서 오른쪽으로 스와이프 (지난 달)
            setCurrentYearMonth((prev) =>
              dayjs(`${prev}-01`, 'YYYY-MM-DD').subtract(1, 'month').format('YYYY-MM')
            );
          }
        }
      },
      onPanResponderTerminate: (_, gestureState) => {
        if (monthlySwipeTriggeredRef.current) return;
        if (
          Math.abs(gestureState.dx) >= 35 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2
        ) {
          monthlySwipeTriggeredRef.current = true;
          if (gestureState.dx < 0) {
            setCurrentYearMonth((prev) =>
              dayjs(`${prev}-01`, 'YYYY-MM-DD').add(1, 'month').format('YYYY-MM')
            );
          } else {
            setCurrentYearMonth((prev) =>
              dayjs(`${prev}-01`, 'YYYY-MM-DD').subtract(1, 'month').format('YYYY-MM')
            );
          }
        }
      },
    })
  ).current;

  // 주간 뷰 전용 좌우 스와이프 제스처 (좌->우: 지난주, 우->좌: 다음주 이동)
  const weeklySwipeTriggeredRef = useRef(false);
  const weeklyPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        weeklySwipeTriggeredRef.current = false;
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
        if (weeklySwipeTriggeredRef.current) return;
        if (
          Math.abs(gestureState.dx) >= 35 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2
        ) {
          weeklySwipeTriggeredRef.current = true;
          if (gestureState.dx < 0) {
            // 오른쪽에서 왼쪽으로 스와이프 (다음 주)
            setSelectedWeekDate((prev) => prev.add(1, 'week'));
          } else {
            // 왼쪽에서 오른쪽으로 스와이프 (지난 주)
            setSelectedWeekDate((prev) => prev.subtract(1, 'week'));
          }
        }
      },
      onPanResponderTerminate: (_, gestureState) => {
        if (weeklySwipeTriggeredRef.current) return;
        if (
          Math.abs(gestureState.dx) >= 35 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2
        ) {
          weeklySwipeTriggeredRef.current = true;
          if (gestureState.dx < 0) {
            setSelectedWeekDate((prev) => prev.add(1, 'week'));
          } else {
            setSelectedWeekDate((prev) => prev.subtract(1, 'week'));
          }
        }
      },
    })
  ).current;

  const loadCalendarData = useCallback(() => {
    const budget = getMonthlyBudget(currentYearMonth);
    setBudget(budget);

    // 수동 추가 입력 할부금 로드
    const manualVal = getManualInstallment(currentYearMonth);
    setManualInstallmentStr(manualVal > 0 ? formatNumberWithComma(manualVal) : '');

    // 1. 저장된 실제 거래 내역 조회 (당월)
    const txs = transactionDao.getTransactionsByMonth(currentYearMonth);

    // 2. 정기 결제 내역 합산
    const recurringRules = recurringDao.getAllRecurringRules();
    const daysInMonth = dayjs(currentYearMonth, 'YYYY-MM').daysInMonth();

    const expenseTotals: { [date: string]: number } = {};
    const savingsTotals: { [date: string]: number } = {};

    // DB 거래 내역 반영 (할부인 경우 월 분할 청구액을 쓴돈으로 반영)
    txs.forEach((tx) => {
      if (tx.categoryType === 'EXPENSE') {
        if (tx.installmentType === 'INSTALLMENT' && tx.installmentMonths > 1) {
          const monthlyAmount = Math.round(tx.amount / tx.installmentMonths);
          expenseTotals[tx.date] = (expenseTotals[tx.date] || 0) + monthlyAmount;
        } else {
          expenseTotals[tx.date] = (expenseTotals[tx.date] || 0) + tx.amount;
        }
      } else if (tx.categoryType === 'SAVINGS') {
        savingsTotals[tx.date] = (savingsTotals[tx.date] || 0) + tx.amount;
      }
    });

    // 정기 결제 규칙 반영
    recurringRules.forEach((rule) => {
      const ruleStartStr = rule.startDate || `${currentYearMonth}-01`;
      const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');

      for (let day = 1; day <= daysInMonth; day++) {
        const rawDate = `${currentYearMonth}-${String(day).padStart(2, '0')}`;
        let applies = false;

        if (dayjs(rawDate).isSameOrAfter(dayjs(ruleStartStr), 'day')) {
          if (repeatType === 'DAILY') {
            applies = true;
          } else if (repeatType === 'MONTHLY_DAY') {
            applies = day === rule.dayOfMonth;
          } else if (repeatType === 'WEEKLY_DAYS') {
            const dayOfWeek = dayjs(rawDate).day(); // 0:일, 1:월, ... 6:토
            applies = (rule.daysOfWeek || []).includes(dayOfWeek);
          }
        }

        if (applies) {
          if (rule.categoryType === 'EXPENSE') {
            const effectiveDate = getNextBusinessDay(rawDate, 'EXPENSE');
            expenseTotals[effectiveDate] = (expenseTotals[effectiveDate] || 0) + rule.amount;
          } else if (rule.categoryType === 'SAVINGS') {
            savingsTotals[rawDate] = (savingsTotals[rawDate] || 0) + rule.amount;
          }
        }
      }
    });

    // 3. DB의 모든 할부 결제 내역을 스캔하여 잔여 할부 회차가 남아있는 건만 필터링 (12개월 초과 장기 할부 포함)
    const allInstallmentTxs = transactionDao.getAllInstallmentTransactions();
    const currentMoment = dayjs(`${currentYearMonth}-01`, 'YYYY-MM-DD').startOf('month');

    const detailList: InstallmentItemDetail[] = [];
    let autoSum = 0;

    allInstallmentTxs.forEach((tx) => {
      const txMoment = dayjs(tx.date, 'YYYY-MM-DD').startOf('month');
      const monthsElapsed = currentMoment.diff(txMoment, 'month');

      // 조회 월 기준 할부 회차가 종료되지 않고 아직 남아있는 건만 포함 (12개월 초과 장기 할부 포함)
      if (monthsElapsed >= 0 && monthsElapsed < tx.installmentMonths) {
        const monthlyAmount = Math.round(tx.amount / tx.installmentMonths);
        const currentCount = monthsElapsed + 1;
        const remainingCount = tx.installmentMonths - currentCount;

        autoSum += monthlyAmount;

        detailList.push({
          id: tx.id,
          merchant: tx.merchant,
          cardCompany: tx.cardCompany || '카드',
          monthlyAmount,
          totalPrincipal: tx.amount,
          installmentMonths: tx.installmentMonths,
          currentCount,
          remainingCount,
          isManualInput: false,
        });
      }
    });

    if (manualVal > 0) {
      detailList.push({
        id: `manual_${currentYearMonth}`,
        merchant: '사용자 직접 입력 건',
        cardCompany: '',
        monthlyAmount: manualVal,
        totalPrincipal: manualVal,
        installmentMonths: 1,
        currentCount: 1,
        remainingCount: 0,
        isManualInput: true,
      });
    }

    setInstallmentDetailItems(detailList);
    setDailyExpenseTotals(expenseTotals);
    setDailySavingsTotals(savingsTotals);
    setThisMonthInstallmentTotal(autoSum + manualVal);
  }, [currentYearMonth]);

  // 화면 활성화(포커스) 및 거래/정기결제 변경 이벤트 발생 시 실시간 자동 재로드
  useFocusEffect(
    useCallback(() => {
      loadCalendarData();
    }, [loadCalendarData])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('TRANSACTION_UPDATED', () => {
      loadCalendarData();
    });
    return () => sub.remove();
  }, [loadCalendarData]);

  const handleToggleViewMode = (mode: ViewMode) => {
    setMode(mode);
    setStorageViewMode(mode);
  };

  const handleSaveManualInstallment = () => {
    const val = parseNumberFromComma(manualInstallmentStr);
    const parsed = isNaN(val) ? 0 : val;
    setManualInstallment(currentYearMonth, parsed);
    Alert.alert('성공', `${currentYearMonth}월 수동 입력 할부금이 저장되었습니다.`);
    loadCalendarData();
  };

  const dailyBudget = calculateDailyBudget(monthlyBudget, currentYearMonth);

  // 해당 날짜가 속한 주의 월요일 계산 (월~일 순서)
  const getStartOfWeekMonday = (baseDate: dayjs.Dayjs) => {
    const dayOfWeek = baseDate.day(); // 0: Sun, 1: Mon, ... 6: Sat
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    return baseDate.add(diffToMonday, 'day');
  };

  const startOfWeekMonday = getStartOfWeekMonday(selectedWeekDate);
  const endOfWeekSunday = startOfWeekMonday.add(6, 'day');

  // 주간 뷰 계산 (해당 주 월~일 총 지출)
  let weekSpent = 0;
  for (let i = 0; i < 7; i++) {
    const dateStr = startOfWeekMonday.add(i, 'day').format('YYYY-MM-DD');
    weekSpent += dailyExpenseTotals[dateStr] || 0;
  }
  const weeklyRemaining = calculateWeeklyRemainingBudget(
    monthlyBudget,
    weekSpent,
    currentYearMonth
  );

  // 캘린더 날짜 셀 내의 커스텀 금액 텍스트 가독성 정제 함수
  const formatCompactAmount = (amt: number): string => {
    const abs = Math.abs(amt);
    if (abs >= 100000000) {
      return `${amt < 0 ? '-' : ''}${(abs / 100000000).toFixed(1)}억`;
    }
    if (abs >= 10000) {
      const man = Math.floor(abs / 10000);
      const remainder = abs % 10000;
      if (remainder === 0) {
        return `${amt < 0 ? '-' : ''}${man}만`;
      }
    }
    return amt.toLocaleString();
  };

  // 커스텀 날짜 셀 렌더링 (월간 뷰용) - 지출은 상단(1줄), 적금은 하단(2줄) 위치 고정
  const customDayComponent = ({ date, state }: any) => {
    if (!date) return null;
    const dateStr = date.dateString;
    const isRed = isRedDay(dateStr);
    const expenseAmount = dailyExpenseTotals[dateStr] || 0;
    const savingsAmount = dailySavingsTotals[dateStr] || 0;
    const color = getBudgetStatusColor(expenseAmount, dailyBudget);
    const isToday = dateStr === dayjs().format('YYYY-MM-DD');

    return (
      <TouchableOpacity
        style={[styles.dayCell, isToday && styles.todayCell]}
        onPress={() => onSelectDate(dateStr)}
      >
        <Text
          style={[
            styles.dayText,
            isRed && styles.redDayText,
            state === 'disabled' && styles.disabledText,
            isToday && styles.todayText,
          ]}
        >
          {date.day}
        </Text>

        {/* 상단 1줄: 지출 고정 영역 (지출이 없을 경우 빈 줄 유지) */}
        <View style={styles.slotRow}>
          {expenseAmount !== 0 ? (
            <Text
              style={[styles.amountText, { color }]}
              numberOfLines={1}
              adjustsFontSizeToFit={true}
              minimumFontScale={0.65}
            >
              {formatCompactAmount(expenseAmount)}
            </Text>
          ) : (
            <Text style={[styles.amountText, { opacity: 0 }]}> </Text>
          )}
        </View>

        {/* 하단 2줄: 적금/저축 고정 영역 (적금이 없을 경우 빈 줄 유지) */}
        <View style={styles.slotRow}>
          {savingsAmount > 0 ? (
            <Text
              style={[styles.amountText, { color: '#1565C0' }]}
              numberOfLines={1}
              adjustsFontSizeToFit={true}
              minimumFontScale={0.65}
            >
              🏦{formatCompactAmount(savingsAmount)}
            </Text>
          ) : (
            <Text style={[styles.amountText, { opacity: 0 }]}> </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const daysOfWeekNames = ['월', '화', '수', '목', '금', '토', '일'];

  return (
    <View style={styles.container}>
      <BudgetHeaderBanner
        viewMode={viewMode}
        onToggleViewMode={handleToggleViewMode}
        dailyBudget={dailyBudget}
        weeklyRemaining={weeklyRemaining}
      />

      {viewMode === 'MONTHLY' ? (
        <View style={{ flex: 1 }} {...monthlyPanResponder.panHandlers}>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            <Calendar
              key={currentYearMonth}
              initialDate={`${currentYearMonth}-01`}
              current={`${currentYearMonth}-01`}
              onMonthChange={(month: any) => {
                const ym = `${month.year}-${String(month.month).padStart(2, '0')}`;
                setCurrentYearMonth(ym);
              }}
              dayComponent={customDayComponent}
              theme={{
                backgroundColor: '#FFFFFF',
                calendarBackground: '#FFFFFF',
                textSectionTitleColor: '#666666',
                selectedDayBackgroundColor: '#2196F3',
                todayTextColor: '#2196F3',
                arrowColor: '#2196F3',
              }}
            />

            {/* 월간 뷰 하단: 이번 달 총 할부 청구금액 카드 & 🔍 상세 모달 버튼 & 수동 기입 영역 */}
            <View style={styles.installmentSummaryCard}>
              <View style={styles.installmentHeaderRow}>
                <Text style={styles.installmentCardTitle}>💳 이번 달 총 할부 청구금액</Text>
                <TouchableOpacity
                  style={styles.magnifierBtn}
                  activeOpacity={0.7}
                  delayPressIn={0}
                  onPress={() => setInstallmentModalVisible(true)}
                >
                  <Text style={styles.magnifierBtnText}>🔍 상세보기</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.installmentCardAmount}>
                {thisMonthInstallmentTotal.toLocaleString()} 원
              </Text>

              <View style={styles.manualInputRow}>
                <Text style={styles.manualInputLabel}>사용자 추가 기입:</Text>
                <TextInput
                  style={styles.manualInput}
                  placeholder="0"
                  keyboardType="numeric"
                  value={manualInstallmentStr}
                  onChangeText={(text) => setManualInstallmentStr(formatNumberWithComma(text))}
                  disableFullscreenUI={true}
                />
                <Text style={styles.unitText}>원</Text>
                <TouchableOpacity
                  style={styles.manualSaveBtn}
                  activeOpacity={0.7}
                  delayPressIn={0}
                  onPress={handleSaveManualInstallment}
                >
                  <Text style={styles.manualSaveBtnText}>저장</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      ) : (
        <View style={{ flex: 1 }} {...weeklyPanResponder.panHandlers}>
          <ScrollView
            style={styles.weeklyScrollView}
            contentContainerStyle={styles.weeklyContent}
            keyboardShouldPersistTaps="always"
          >
          {/* 주간 이동 컨트롤러 */}
          <View style={styles.weekHeader}>
            <TouchableOpacity
              style={styles.weekArrowButton}
              onPress={() => setSelectedWeekDate(selectedWeekDate.subtract(1, 'week'))}
            >
              <Text style={styles.weekArrowText}>◀ 지난 주</Text>
            </TouchableOpacity>

            <View style={styles.weekTitleContainer}>
              <Text style={styles.weekTitleText}>
                {startOfWeekMonday.format('M/D(월)')} ~ {endOfWeekSunday.format('M/D(일)')}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.weekArrowButton}
              onPress={() => setSelectedWeekDate(selectedWeekDate.add(1, 'week'))}
            >
              <Text style={styles.weekArrowText}>다음 주 ▶</Text>
            </TouchableOpacity>
          </View>

          {/* 오늘 주차로 이동 버튼 */}
          {!selectedWeekDate.isSame(dayjs(), 'week') && (
            <TouchableOpacity
              style={styles.todayResetButton}
              onPress={() => setSelectedWeekDate(dayjs())}
            >
              <Text style={styles.todayResetText}>오늘 주차로 이동</Text>
            </TouchableOpacity>
          )}

          {/* 월요일 ~ 일요일 (7일) 상세 카드 목록 */}
          {daysOfWeekNames.map((dayName, index) => {
            const dayMoment = startOfWeekMonday.add(index, 'day');
            const dateStr = dayMoment.format('YYYY-MM-DD');
            const isRed = isRedDay(dateStr);
            const spentAmount = dailyExpenseTotals[dateStr] || 0;
            const savingsAmount = dailySavingsTotals[dateStr] || 0;
            const isToday = dateStr === dayjs().format('YYYY-MM-DD');
            const isOverBudget = spentAmount > dailyBudget;
            const statusColor =
              spentAmount === 0 ? '#757575' : isOverBudget ? '#D32F2F' : '#2E7D32';

            return (
              <Pressable
                key={dateStr}
                style={({ pressed }) => [
                  styles.weeklyCardItem,
                  isToday && styles.weeklyCardItemToday,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => onSelectDate(dateStr)}
              >
                <View style={styles.weeklyCardHeader}>
                  <View style={styles.weeklyCardTitleRow}>
                    <Text
                      style={[
                        styles.weeklyDayName,
                        isRed && styles.weeklyRedDayName,
                        isToday && styles.weeklyDayNameToday,
                      ]}
                    >
                      {dayName}요일 ({dayMoment.format('M/D')})
                    </Text>
                    {isToday && (
                      <View style={styles.todayBadge}>
                        <Text style={styles.todayBadgeText}>오늘</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.statusBadge, { color: statusColor }]}>
                    {spentAmount === 0
                      ? '지출 없음'
                      : isOverBudget
                      ? `예산 초과 (+${(spentAmount - dailyBudget).toLocaleString()}원)`
                      : `예산 이내 (-${(dailyBudget - spentAmount).toLocaleString()}원)`}
                  </Text>
                </View>

                <View style={styles.weeklyCardBody}>
                  <View style={styles.weeklyInfoRow}>
                    <Text style={styles.weeklyInfoLabel}>일일 권장 금액</Text>
                    <Text style={styles.weeklyInfoValue}>{dailyBudget.toLocaleString()}원</Text>
                  </View>
                  <View style={styles.weeklyInfoRow}>
                    <Text style={styles.weeklyInfoLabel}>실제 사용 금액</Text>
                    <Text
                      style={[
                        styles.weeklyInfoValue,
                        styles.weeklySpentValue,
                        { color: statusColor },
                      ]}
                    >
                      {spentAmount.toLocaleString()}원
                    </Text>
                  </View>

                  {savingsAmount > 0 && (
                    <View style={styles.weeklyInfoRow}>
                      <Text style={styles.weeklyInfoLabel}>적금/저축 금액</Text>
                      <Text
                        style={[
                          styles.weeklyInfoValue,
                          styles.weeklySpentValue,
                          { color: '#1565C0' },
                        ]}
                      >
                        🏦 {savingsAmount.toLocaleString()}원
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
          </ScrollView>
        </View>
      )}

      {/* 할부 내역 🔍 상세 모달 */}
      <InstallmentDetailModal
        visible={installmentModalVisible}
        currentYearMonth={currentYearMonth}
        items={installmentDetailItems}
        totalSum={thisMonthInstallmentTotal}
        onClose={() => setInstallmentModalVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  dayCell: {
    width: 44,
    height: 52,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  todayCell: {
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
  },
  dayText: {
    fontSize: 13,
    color: '#212121',
    fontWeight: '500',
  },
  redDayText: {
    color: '#D32F2F',
    fontWeight: 'bold',
  },
  todayText: {
    fontWeight: 'bold',
    color: '#1976D2',
  },
  disabledText: {
    color: '#BDBDBD',
  },
  slotRow: {
    height: 14,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 1,
  },
  amountText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  installmentSummaryCard: {
    margin: 16,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  installmentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  installmentCardTitle: {
    fontSize: 14,
    color: '#666666',
    fontWeight: '600',
  },
  magnifierBtn: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  magnifierBtnText: {
    fontSize: 12,
    color: '#1976D2',
    fontWeight: 'bold',
  },
  installmentCardAmount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1565C0',
    marginBottom: 10,
  },
  manualInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
    gap: 6,
  },
  manualInputLabel: {
    fontSize: 12,
    color: '#616161',
  },
  manualInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 13,
    color: '#212121',
    backgroundColor: '#FAFAFA',
  },
  unitText: {
    fontSize: 12,
    color: '#616161',
  },
  manualSaveBtn: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  manualSaveBtnText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  /* 주간 뷰 스타일 */
  weeklyScrollView: {
    flex: 1,
  },
  weeklyContent: {
    padding: 16,
  },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  weekArrowButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  weekArrowText: {
    fontSize: 13,
    color: '#2196F3',
    fontWeight: '600',
  },
  weekTitleContainer: {
    alignItems: 'center',
  },
  weekTitleText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#212121',
  },
  todayResetButton: {
    alignSelf: 'center',
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#E3F2FD',
    borderRadius: 16,
  },
  todayResetText: {
    fontSize: 12,
    color: '#1976D2',
    fontWeight: '600',
  },
  weeklyCardItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    elevation: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  weeklyCardItemToday: {
    borderWidth: 2,
    borderColor: '#2196F3',
    backgroundColor: '#F1F8E9',
  },
  weeklyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    paddingBottom: 10,
    marginBottom: 10,
  },
  weeklyCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weeklyDayName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#212121',
  },
  weeklyRedDayName: {
    color: '#D32F2F',
  },
  weeklyDayNameToday: {
    color: '#1565C0',
  },
  todayBadge: {
    marginLeft: 8,
    backgroundColor: '#2196F3',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  todayBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  statusBadge: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  weeklyCardBody: {
    gap: 4,
  },
  weeklyInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weeklyInfoLabel: {
    fontSize: 13,
    color: '#616161',
  },
  weeklyInfoValue: {
    fontSize: 13,
    color: '#212121',
    fontWeight: '500',
  },
  weeklySpentValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
});
