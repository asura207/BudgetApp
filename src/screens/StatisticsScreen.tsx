import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  DeviceEventEmitter,
} from 'react-native';
import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import { useFocusEffect } from '@react-navigation/native';
import { BarChart, LineChart } from 'react-native-gifted-charts';
import { transactionDao } from '../database/transactionDao';
import { recurringDao } from '../database/recurringDao';
import { getNicknameCreatedAt, getManualInstallment, getMonthlyBudget } from '../storage/mmkv';
import { Transaction } from '../types/budget';

dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

export const StatisticsScreen = () => {
  const nicknameCreatedAtStr = getNicknameCreatedAt();
  const nicknameStartYear = dayjs(nicknameCreatedAtStr).year();
  const currentYearNum = dayjs().year();
  const todayStr = dayjs().format('YYYY-MM-DD');

  // 닉네임 설정 연도를 시작 연도로 설정 (최소 startYear ~ 최대 5년 롤링 윈도우)
  const rawYears: number[] = [];
  for (
    let y = Math.max(nicknameStartYear, currentYearNum - 4);
    y <= Math.max(nicknameStartYear, currentYearNum);
    y++
  ) {
    rawYears.push(y);
  }
  const availableYears = rawYears.length > 0 ? rawYears : [currentYearNum];
  const minSelectableYear = availableYears[0];
  const maxSelectableYear = availableYears[availableYears.length - 1];

  const [selectedYear, setSelectedYear] = useState<number>(currentYearNum);
  const [activeTab, setActiveTab] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');

  // 월별 탭 선택 (1월 ~ 12월, 기본값: 오늘 날짜의 월)
  const [selectedMonth, setSelectedMonth] = useState<number>(dayjs().month() + 1);

  // 연도별 하단 탭 선택 (기본값: 오늘 날짜의 연도)
  const [selectedYearTab, setSelectedYearTab] = useState<number>(currentYearNum);

  const [yearTransactions, setYearTransactions] = useState<Transaction[]>([]);

  const loadStatsData = useCallback(() => {
    const txs = transactionDao.getTransactionsByYear(String(selectedYear));
    setYearTransactions(txs);
  }, [selectedYear]);

  // 화면 진입/활성화 및 거래 변경 이벤트 시 데이터 실시간 자동 재집계
  useFocusEffect(
    useCallback(() => {
      const now = dayjs();
      setSelectedMonth(now.month() + 1);
      setSelectedYearTab(now.year());
      loadStatsData();
    }, [loadStatsData])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('TRANSACTION_UPDATED', () => {
      loadStatsData();
    });
    return () => sub.remove();
  }, [loadStatsData]);

  // 정기 결제/적금 내역 불러오기
  const recurringRules = recurringDao.getAllRecurringRules();

  // 1~12월 각 월별 총 지출 및 적금 집계 (할부인 경우 월 분할 청구액 반영)
  const monthlyExpenseData = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const monthPrefix = `${selectedYear}-${String(m).padStart(2, '0')}`;
    const daysInMonth = dayjs(monthPrefix, 'YYYY-MM').daysInMonth();

    // 1. 실제 DB 내역 (할부 청구액 계산)
    const mtxs = yearTransactions.filter((tx) => tx.date.startsWith(monthPrefix));

    let expense = mtxs
      .filter((tx) => tx.categoryType === 'EXPENSE')
      .reduce((sum, tx) => {
        if (tx.installmentType === 'INSTALLMENT' && tx.installmentMonths > 1) {
          return sum + Math.round(tx.amount / tx.installmentMonths);
        }
        return sum + tx.amount;
      }, 0);

    let savings = mtxs
      .filter(
        (tx) =>
          tx.categoryType === 'SAVINGS' &&
          dayjs(tx.date).isSameOrBefore(dayjs(todayStr), 'day')
      )
      .reduce((sum, tx) => sum + tx.amount, 0);

    // 2. 정기결제/적금 내역 반영 (시작일 이후 AND 오늘 날짜 이하만 누적)
    recurringRules.forEach((rule) => {
      const ruleStartStr = rule.startDate || `${selectedYear}-01-01`;
      const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');

      for (let day = 1; day <= daysInMonth; day++) {
        const rawDate = `${monthPrefix}-${String(day).padStart(2, '0')}`;
        let applies = false;

        if (
          dayjs(rawDate).isSameOrAfter(dayjs(ruleStartStr), 'day') &&
          dayjs(rawDate).isSameOrBefore(dayjs(todayStr), 'day')
        ) {
          if (repeatType === 'DAILY') {
            applies = true;
          } else if (repeatType === 'MONTHLY_DAY') {
            applies = day === rule.dayOfMonth;
          } else if (repeatType === 'WEEKLY_DAYS') {
            const dayOfWeek = dayjs(rawDate).day();
            applies = (rule.daysOfWeek || []).includes(dayOfWeek);
          }
        }

        if (applies) {
          if (rule.categoryType === 'EXPENSE') {
            expense += rule.amount;
          } else if (rule.categoryType === 'SAVINGS') {
            savings += rule.amount;
          }
        }
      }
    });

    return { month: m, monthName: `${m}월`, expense, savings };
  });

  // 1~12월 월별 할부 청구금액 선 그래프(LineChart) 데이터 계산 (자동 파싱 할부금 + 사용자 입력 수동 할부금)
  const lineChartData = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const monthPrefix = `${selectedYear}-${String(m).padStart(2, '0')}`;
    const mtxs = yearTransactions.filter(
      (tx) => tx.date.startsWith(monthPrefix) && tx.installmentType === 'INSTALLMENT' && tx.installmentMonths > 1
    );

    const autoInstallment = mtxs.reduce(
      (sum, tx) => sum + Math.round(tx.amount / tx.installmentMonths),
      0
    );

    const manualInstallment = getManualInstallment(monthPrefix);
    const totalInstallment = autoInstallment + manualInstallment;

    return { value: totalInstallment / 10000, label: `${m}월` };
  });

  // gifted-charts 차트 바 데이터 생성
  const barData = monthlyExpenseData.map((d) => ({
    value: d.expense / 10000, // 만원 단위 표기
    label: d.monthName,
    frontColor: '#2196F3',
  }));

  const totalYearExpense = monthlyExpenseData.reduce((sum, d) => sum + d.expense, 0);
  const totalYearSavings = monthlyExpenseData.reduce((sum, d) => sum + d.savings, 0);

  // 선택된 월의 카드사별 지출 합계 집계 (오늘 날짜 이하 정기결제 포함)
  const getCardCompanyStatsForMonth = (monthNum: number) => {
    const monthPrefix = `${selectedYear}-${String(monthNum).padStart(2, '0')}`;
    const daysInMonth = dayjs(monthPrefix, 'YYYY-MM').daysInMonth();
    const monthTxs = yearTransactions.filter(
      (tx) => tx.date.startsWith(monthPrefix) && tx.categoryType === 'EXPENSE'
    );

    const companyMap: { [company: string]: number } = {};
    let totalMonthExpense = 0;

    monthTxs.forEach((tx) => {
      const companyName =
        tx.paymentType === 'CARD'
          ? tx.cardCompany || '기타 카드'
          : '💵 현금';

      const amountToUse = (tx.installmentType === 'INSTALLMENT' && tx.installmentMonths > 1)
        ? Math.round(tx.amount / tx.installmentMonths)
        : tx.amount;

      companyMap[companyName] = (companyMap[companyName] || 0) + amountToUse;
      totalMonthExpense += amountToUse;
    });

    // 정기 결제 카드 지출 반영 (오늘 이하 날짜만)
    recurringRules.forEach((rule) => {
      if (rule.categoryType === 'EXPENSE') {
        const ruleStartStr = rule.startDate || `${selectedYear}-01-01`;
        const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');
        const companyName =
          rule.paymentType === 'CARD'
            ? rule.cardCompany || '기타 카드'
            : '💵 현금';

        for (let day = 1; day <= daysInMonth; day++) {
          const rawDate = `${monthPrefix}-${String(day).padStart(2, '0')}`;
          let applies = false;

          if (
            dayjs(rawDate).isSameOrAfter(dayjs(ruleStartStr), 'day') &&
            dayjs(rawDate).isSameOrBefore(dayjs(todayStr), 'day')
          ) {
            if (repeatType === 'DAILY') {
              applies = true;
            } else if (repeatType === 'MONTHLY_DAY') {
              applies = day === rule.dayOfMonth;
            } else if (repeatType === 'WEEKLY_DAYS') {
              const dayOfWeek = dayjs(rawDate).day();
              applies = (rule.daysOfWeek || []).includes(dayOfWeek);
            }
          }

          if (applies) {
            companyMap[companyName] = (companyMap[companyName] || 0) + rule.amount;
            totalMonthExpense += rule.amount;
          }
        }
      }
    });

    const result = Object.keys(companyMap).map((company) => {
      const amount = companyMap[company];
      const percentage =
        totalMonthExpense > 0
          ? ((amount / totalMonthExpense) * 100).toFixed(1)
          : '0.0';
      return { company, amount, percentage };
    });

    return { list: result, totalMonthExpense };
  };

  // 선택된 월의 적금/저축 합계 집계 (조회 당일 포함 이전 일의 기록만 합산)
  const getSavingsStatsForMonth = (monthNum: number) => {
    const monthPrefix = `${selectedYear}-${String(monthNum).padStart(2, '0')}`;
    const daysInMonth = dayjs(monthPrefix, 'YYYY-MM').daysInMonth();
    const monthTxs = yearTransactions.filter(
      (tx) =>
        tx.date.startsWith(monthPrefix) &&
        tx.categoryType === 'SAVINGS' &&
        dayjs(tx.date).isSameOrBefore(dayjs(todayStr), 'day')
    );

    const savingsMap: { [name: string]: number } = {};
    let totalMonthSavings = 0;

    monthTxs.forEach((tx) => {
      const name = tx.merchant || '일반 적금';
      savingsMap[name] = (savingsMap[name] || 0) + tx.amount;
      totalMonthSavings += tx.amount;
    });

    // 정기 적금 내역 반영 (오늘 이하 날짜만)
    recurringRules.forEach((rule) => {
      if (rule.categoryType === 'SAVINGS') {
        const ruleStartStr = rule.startDate || `${selectedYear}-01-01`;
        const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');
        const name = rule.merchant || '정기 적금';

        for (let day = 1; day <= daysInMonth; day++) {
          const rawDate = `${monthPrefix}-${String(day).padStart(2, '0')}`;
          let applies = false;

          if (
            dayjs(rawDate).isSameOrAfter(dayjs(ruleStartStr), 'day') &&
            dayjs(rawDate).isSameOrBefore(dayjs(todayStr), 'day')
          ) {
            if (repeatType === 'DAILY') {
              applies = true;
            } else if (repeatType === 'MONTHLY_DAY') {
              applies = day === rule.dayOfMonth;
            } else if (repeatType === 'WEEKLY_DAYS') {
              const dayOfWeek = dayjs(rawDate).day();
              applies = (rule.daysOfWeek || []).includes(dayOfWeek);
            }
          }

          if (applies) {
            savingsMap[name] = (savingsMap[name] || 0) + rule.amount;
            totalMonthSavings += rule.amount;
          }
        }
      }
    });

    const result = Object.keys(savingsMap).map((name) => {
      const amount = savingsMap[name];
      const percentage =
        totalMonthSavings > 0
          ? ((amount / totalMonthSavings) * 100).toFixed(1)
          : '0.0';
      return { name, amount, percentage };
    });

    return { list: result, totalMonthSavings };
  };

  // 선택된 연도의 카드사별 지출 합계 집계 (오늘 날짜 이하 정기결제 포함)
  const getCardCompanyStatsForYear = (yearNum: number) => {
    const txs = transactionDao.getTransactionsByYear(String(yearNum));
    const expenseTxs = txs.filter((tx) => tx.categoryType === 'EXPENSE');

    const companyMap: { [company: string]: number } = {};
    let totalExpense = 0;

    expenseTxs.forEach((tx) => {
      const companyName =
        tx.paymentType === 'CARD'
          ? tx.cardCompany || '기타 카드'
          : '💵 현금';
      const amountToUse = (tx.installmentType === 'INSTALLMENT' && tx.installmentMonths > 1)
        ? Math.round(tx.amount / tx.installmentMonths)
        : tx.amount;

      companyMap[companyName] = (companyMap[companyName] || 0) + amountToUse;
      totalExpense += amountToUse;
    });

    // 정기 결제 카드 지출 반영 (오늘 이하 날짜만)
    recurringRules.forEach((rule) => {
      if (rule.categoryType === 'EXPENSE') {
        const ruleStartStr = rule.startDate || `${yearNum}-01-01`;
        const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');
        const companyName =
          rule.paymentType === 'CARD'
            ? rule.cardCompany || '기타 카드'
            : '💵 현금';

        for (let m = 1; m <= 12; m++) {
          const monthPrefix = `${yearNum}-${String(m).padStart(2, '0')}`;
          const daysInMonth = dayjs(monthPrefix, 'YYYY-MM').daysInMonth();

          for (let day = 1; day <= daysInMonth; day++) {
            const rawDate = `${monthPrefix}-${String(day).padStart(2, '0')}`;
            let applies = false;

            if (
              dayjs(rawDate).isSameOrAfter(dayjs(ruleStartStr), 'day') &&
              dayjs(rawDate).isSameOrBefore(dayjs(todayStr), 'day')
            ) {
              if (repeatType === 'DAILY') {
                applies = true;
              } else if (repeatType === 'MONTHLY_DAY') {
                applies = day === rule.dayOfMonth;
              } else if (repeatType === 'WEEKLY_DAYS') {
                const dayOfWeek = dayjs(rawDate).day();
                applies = (rule.daysOfWeek || []).includes(dayOfWeek);
              }
            }

            if (applies) {
              companyMap[companyName] = (companyMap[companyName] || 0) + rule.amount;
              totalExpense += rule.amount;
            }
          }
        }
      }
    });

    const result = Object.keys(companyMap).map((company) => {
      const amount = companyMap[company];
      const percentage =
        totalExpense > 0 ? ((amount / totalExpense) * 100).toFixed(1) : '0.0';
      return { company, amount, percentage };
    });

    return { list: result, totalExpense };
  };

  // 선택된 연도의 적금/저축 합계 집계 (조회 당일 포함 이전 일의 기록만 합산)
  const getSavingsStatsForYear = (yearNum: number) => {
    const txs = transactionDao.getTransactionsByYear(String(yearNum));
    const savingsTxs = txs.filter(
      (tx) =>
        tx.categoryType === 'SAVINGS' &&
        dayjs(tx.date).isSameOrBefore(dayjs(todayStr), 'day')
    );

    const savingsMap: { [name: string]: number } = {};
    let totalSavings = 0;

    savingsTxs.forEach((tx) => {
      const name = tx.merchant || '일반 적금';
      savingsMap[name] = (savingsMap[name] || 0) + tx.amount;
      totalSavings += tx.amount;
    });

    // 정기 적금/저축 내역 반영 (조회 당일 포함 이전 일의 기록만 합산)
    recurringRules.forEach((rule) => {
      if (rule.categoryType === 'SAVINGS') {
        const ruleStartStr = rule.startDate || `${yearNum}-01-01`;
        const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');
        const name = rule.merchant || '정기 적금';

        for (let m = 1; m <= 12; m++) {
          const monthPrefix = `${yearNum}-${String(m).padStart(2, '0')}`;
          const daysInMonth = dayjs(monthPrefix, 'YYYY-MM').daysInMonth();

          for (let day = 1; day <= daysInMonth; day++) {
            const rawDate = `${monthPrefix}-${String(day).padStart(2, '0')}`;
            let applies = false;

            if (
              dayjs(rawDate).isSameOrAfter(dayjs(ruleStartStr), 'day') &&
              dayjs(rawDate).isSameOrBefore(dayjs(todayStr), 'day')
            ) {
              if (repeatType === 'DAILY') {
                applies = true;
              } else if (repeatType === 'MONTHLY_DAY') {
                applies = day === rule.dayOfMonth;
              } else if (repeatType === 'WEEKLY_DAYS') {
                const dayOfWeek = dayjs(rawDate).day();
                applies = (rule.daysOfWeek || []).includes(dayOfWeek);
              }
            }

            if (applies) {
              savingsMap[name] = (savingsMap[name] || 0) + rule.amount;
              totalSavings += rule.amount;
            }
          }
        }
      }
    });

    const result = Object.keys(savingsMap).map((name) => {
      const amount = savingsMap[name];
      const percentage =
        totalSavings > 0 ? ((amount / totalSavings) * 100).toFixed(1) : '0.0';
      return { name, amount, percentage };
    });

    return { list: result, totalSavings };
  };

  // 연도별 비교 테이블용 데이터 (적금/저축 및 정기결제는 조회 당일 포함 이전 일의 기록만 합산)
  const yearlyComparisonData = availableYears.map((y) => {
    const txs = transactionDao.getTransactionsByYear(String(y));
    let expense = txs
      .filter((tx) => tx.categoryType === 'EXPENSE')
      .reduce((sum, tx) => {
        if (tx.installmentType === 'INSTALLMENT' && tx.installmentMonths > 1) {
          return sum + Math.round(tx.amount / tx.installmentMonths);
        }
        return sum + tx.amount;
      }, 0);

    let savings = txs
      .filter(
        (tx) =>
          tx.categoryType === 'SAVINGS' &&
          dayjs(tx.date).isSameOrBefore(dayjs(todayStr), 'day')
      )
      .reduce((sum, tx) => sum + tx.amount, 0);

    // 정기결제/적금 내역 반영 (시작일 이후 AND 조회 당일 포함 이전 일만 누적)
    recurringRules.forEach((rule) => {
      const ruleStartStr = rule.startDate || `${y}-01-01`;
      const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');

      for (let m = 1; m <= 12; m++) {
        const monthPrefix = `${y}-${String(m).padStart(2, '0')}`;
        const daysInMonth = dayjs(monthPrefix, 'YYYY-MM').daysInMonth();

        for (let day = 1; day <= daysInMonth; day++) {
          const rawDate = `${monthPrefix}-${String(day).padStart(2, '0')}`;
          let applies = false;

          if (
            dayjs(rawDate).isSameOrAfter(dayjs(ruleStartStr), 'day') &&
            dayjs(rawDate).isSameOrBefore(dayjs(todayStr), 'day')
          ) {
            if (repeatType === 'DAILY') {
              applies = true;
            } else if (repeatType === 'MONTHLY_DAY') {
              applies = day === rule.dayOfMonth;
            } else if (repeatType === 'WEEKLY_DAYS') {
              const dayOfWeek = dayjs(rawDate).day();
              applies = (rule.daysOfWeek || []).includes(dayOfWeek);
            }
          }

          if (applies) {
            if (rule.categoryType === 'EXPENSE') {
              expense += rule.amount;
            } else if (rule.categoryType === 'SAVINGS') {
              savings += rule.amount;
            }
          }
        }
      }
    });

    return { year: `${y}년`, yearNum: y, expense, savings };
  });

  const monthCardStats = getCardCompanyStatsForMonth(selectedMonth);
  const monthSavingsStats = getSavingsStatsForMonth(selectedMonth);

  const yearCardStats = getCardCompanyStatsForYear(selectedYearTab);
  const yearSavingsStats = getSavingsStatsForYear(selectedYearTab);

  // 월별 예산, 사용 금액, 잔액 계산
  const monthlyBudget = getMonthlyBudget();
  const monthSpent = monthCardStats.totalMonthExpense;
  const monthBalance = monthlyBudget - monthSpent;
  const isUnderBudget = monthBalance >= 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 연도 선택기 (닉네임 설정일 시작 연도 기준 제한) */}
      <View style={styles.yearPickerRow}>
        <TouchableOpacity
          onPress={() => setSelectedYear(Math.max(minSelectableYear, selectedYear - 1))}
          style={[styles.arrowBtn, selectedYear <= minSelectableYear && styles.arrowBtnDisabled]}
          disabled={selectedYear <= minSelectableYear}
          activeOpacity={0.7}
          delayPressIn={0}
        >
          <Text
            style={[
              styles.arrowText,
              selectedYear <= minSelectableYear && styles.arrowTextDisabled,
            ]}
          >
            ◀
          </Text>
        </TouchableOpacity>

        <Text style={styles.yearTitle}>{selectedYear}년 통계</Text>

        <TouchableOpacity
          onPress={() => setSelectedYear(Math.min(maxSelectableYear, selectedYear + 1))}
          style={[styles.arrowBtn, selectedYear >= maxSelectableYear && styles.arrowBtnDisabled]}
          disabled={selectedYear >= maxSelectableYear}
          activeOpacity={0.7}
          delayPressIn={0}
        >
          <Text
            style={[
              styles.arrowText,
              selectedYear >= maxSelectableYear && styles.arrowTextDisabled,
            ]}
          >
            ▶
          </Text>
        </TouchableOpacity>
      </View>

      {/* 탭 토글 (월별 지출 추이 / 연도별 비교) */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'MONTHLY' && styles.activeTabBtn]}
          activeOpacity={0.7}
          delayPressIn={0}
          onPress={() => setActiveTab('MONTHLY')}
        >
          <Text
            style={[
              styles.tabBtnText,
              activeTab === 'MONTHLY' && styles.activeTabBtnText,
            ]}
          >
            월별 지출 추이
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'YEARLY' && styles.activeTabBtn]}
          activeOpacity={0.7}
          delayPressIn={0}
          onPress={() => setActiveTab('YEARLY')}
        >
          <Text
            style={[
              styles.tabBtnText,
              activeTab === 'YEARLY' && styles.activeTabBtnText,
            ]}
          >
            연도별 비교
          </Text>
        </TouchableOpacity>
      </View>

      {/* 1. 월별 통계 뷰 */}
      {activeTab === 'MONTHLY' && (
        <View>
          {/* 1~12월 스크롤형 탭 */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.monthScrollTab}
            contentContainerStyle={styles.monthScrollContent}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <TouchableOpacity
                key={m}
                activeOpacity={0.7}
                delayPressIn={0}
                style={[
                  styles.monthChip,
                  selectedMonth === m && styles.selectedMonthChip,
                ]}
                onPress={() => setSelectedMonth(m)}
              >
                <Text
                  style={[
                    styles.monthChipText,
                    selectedMonth === m && styles.selectedMonthChipText,
                  ]}
                >
                  {m}월
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* 월별 예산, 사용한 금액, 잔액 요약 카드 */}
          <View style={styles.budgetSummaryCard}>
            <Text style={styles.budgetSummaryTitle}>
              💰 {selectedYear}년 {selectedMonth}월 예산 및 지출 요약
            </Text>

            <View style={styles.budgetRow}>
              <Text style={styles.budgetLabel}>목표 예산</Text>
              <Text style={styles.budgetValue}>{monthlyBudget.toLocaleString()} 원</Text>
            </View>

            <View style={styles.budgetRow}>
              <Text style={styles.budgetLabel}>사용한 금액 (총 지출)</Text>
              <Text style={[styles.budgetValue, { color: '#D32F2F' }]}>
                {monthSpent.toLocaleString()} 원
              </Text>
            </View>

            <View style={[styles.budgetRow, styles.balanceRow]}>
              <Text style={styles.balanceLabel}>예산 잔액 (남은 금액)</Text>
              <Text
                style={[
                  styles.balanceValue,
                  isUnderBudget ? { color: '#2E7D32' } : { color: '#D32F2F' },
                ]}
              >
                {isUnderBudget
                  ? `+${monthBalance.toLocaleString()} 원`
                  : `-${Math.abs(monthBalance).toLocaleString()} 원`}
              </Text>
            </View>
          </View>

          {/* 지출 막대 차트 */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>📊 1~12월 지출 차트 (단위: 만원)</Text>
            <View style={{ marginTop: 16 }}>
              <BarChart
                data={barData}
                barWidth={16}
                spacing={12}
                roundedTop
                hideRules
                xAxisThickness={1}
                yAxisThickness={1}
                xAxisColor="#E0E0E0"
                yAxisColor="#E0E0E0"
                noOfSections={4}
              />
            </View>
          </View>

          {/* 월별 할부금 변화량 선 그래프 (Line Chart) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>📈 1~12월 월별 할부금 변화량 추이 (단위: 만원)</Text>
            <View style={{ marginTop: 16 }}>
              <LineChart
                data={lineChartData}
                color="#2196F3"
                thickness={3}
                dataPointsColor="#1565C0"
                dataPointsRadius={5}
                textColor="#212121"
                textFontSize={11}
                curved
                hideRules
                xAxisThickness={1}
                yAxisThickness={1}
                xAxisColor="#E0E0E0"
                yAxisColor="#E0E0E0"
                noOfSections={4}
              />
            </View>
          </View>

          {/* 수치 요약 */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>📈 {selectedYear}년 통계 수치 요약</Text>
            <View style={styles.summaryItem}>
              <Text style={styles.label}>총 지출 금액:</Text>
              <Text style={styles.valueExpense}>
                {totalYearExpense.toLocaleString()} 원
              </Text>
            </View>

            <View style={styles.summaryItem}>
              <Text style={styles.label}>총 적금/저축 금액:</Text>
              <Text style={styles.valueSavings}>
                {totalYearSavings.toLocaleString()} 원
              </Text>
            </View>
          </View>

          {/* 하단 영역 1: 카드사별 지출 표 */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>💳 {selectedMonth}월 카드사별 지출 합계</Text>

            {/* 카드사별 사용금액 표 */}
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 2 }]}>카드사 / 결제수단</Text>
              <Text style={[styles.th, { flex: 2 }]}>사용 금액</Text>
              <Text style={[styles.th, { flex: 1 }]}>비율</Text>
            </View>

            {monthCardStats.list.length > 0 ? (
              monthCardStats.list.map((item) => (
                <View key={item.company} style={styles.tableRow}>
                  <Text style={[styles.tdBold, { flex: 2 }]}>{item.company}</Text>
                  <Text style={[styles.tdExpense, { flex: 2 }]}>
                    {item.amount.toLocaleString()} 원
                  </Text>
                  <Text style={[styles.tdPercent, { flex: 1 }]}>{item.percentage}%</Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyTableBox}>
                <Text style={styles.emptyTableText}>
                  {selectedMonth}월 지출 내역이 없습니다.
                </Text>
              </View>
            )}

            {monthCardStats.list.length > 0 && (
              <View style={styles.tableTotalRow}>
                <Text style={styles.tableTotalLabel}>지출 합계</Text>
                <Text style={styles.tableTotalValue}>
                  {monthCardStats.totalMonthExpense.toLocaleString()} 원
                </Text>
              </View>
            )}
          </View>

          {/* 하단 영역 2: 1~12월 적금/저축 합계 표 (지출 합계 밑 영역) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🏦 {selectedMonth}월 적금/저축 합계</Text>

            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 2 }]}>적금 항목 / 사용처</Text>
              <Text style={[styles.th, { flex: 2 }]}>적금 금액</Text>
              <Text style={[styles.th, { flex: 1 }]}>비율</Text>
            </View>

            {monthSavingsStats.list.length > 0 ? (
              monthSavingsStats.list.map((item) => (
                <View key={item.name} style={styles.tableRow}>
                  <Text style={[styles.tdBold, { flex: 2 }]}>{item.name}</Text>
                  <Text style={[styles.tdSavings, { flex: 2 }]}>
                    {item.amount.toLocaleString()} 원
                  </Text>
                  <Text style={[styles.tdPercent, { flex: 1 }]}>{item.percentage}%</Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyTableBox}>
                <Text style={styles.emptyTableText}>
                  {selectedMonth}월 적금/저축 내역이 없습니다.
                </Text>
              </View>
            )}

            {monthSavingsStats.list.length > 0 && (
              <View style={styles.tableTotalRow}>
                <Text style={styles.tableTotalLabel}>적금 합계</Text>
                <Text style={styles.tableTotalSavingsValue}>
                  {monthSavingsStats.totalMonthSavings.toLocaleString()} 원
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* 2. 연도별 통계 뷰 */}
      {activeTab === 'YEARLY' && (
        <View>
          {/* 연도별 비교 테이블 */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🗓️ {availableYears.length}개년 지출 및 저축 추이 비교</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 1 }]}>연도</Text>
              <Text style={[styles.th, { flex: 2 }]}>총 지출</Text>
              <Text style={[styles.th, { flex: 2 }]}>총 저축/적금</Text>
            </View>

            {yearlyComparisonData.map((y) => (
              <View key={y.year} style={styles.tableRow}>
                <Text style={[styles.tdBold, { flex: 1 }]}>{y.year}</Text>
                <Text style={[styles.tdExpense, { flex: 2 }]}>
                  {y.expense.toLocaleString()} 원
                </Text>
                <Text style={[styles.tdSavings, { flex: 2 }]}>
                  {y.savings.toLocaleString()} 원
                </Text>
              </View>
            ))}
          </View>

          {/* 하단 영역 1: 연도별 탭 & 카드사별 지출 표 */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>💳 {selectedYearTab}년 카드사별 지출 합계</Text>

            {/* 연도별 탭 */}
            <View style={styles.yearTabRow}>
              {availableYears.map((y) => (
                <TouchableOpacity
                  key={y}
                  activeOpacity={0.7}
                  delayPressIn={0}
                  style={[
                    styles.yearChip,
                    selectedYearTab === y && styles.selectedYearChip,
                  ]}
                  onPress={() => setSelectedYearTab(y)}
                >
                  <Text
                    style={[
                      styles.yearChipText,
                      selectedYearTab === y && styles.selectedYearChipText,
                    ]}
                  >
                    {y}년
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* 카드사별 사용금액 표 */}
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 2 }]}>카드사 / 결제수단</Text>
              <Text style={[styles.th, { flex: 2 }]}>사용 금액</Text>
              <Text style={[styles.th, { flex: 1 }]}>비율</Text>
            </View>

            {yearCardStats.list.length > 0 ? (
              yearCardStats.list.map((item) => (
                <View key={item.company} style={styles.tableRow}>
                  <Text style={[styles.tdBold, { flex: 2 }]}>{item.company}</Text>
                  <Text style={[styles.tdExpense, { flex: 2 }]}>
                    {item.amount.toLocaleString()} 원
                  </Text>
                  <Text style={[styles.tdPercent, { flex: 1 }]}>{item.percentage}%</Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyTableBox}>
                <Text style={styles.emptyTableText}>
                  {selectedYearTab}년 지출 내역이 없습니다.
                </Text>
              </View>
            )}

            {yearCardStats.list.length > 0 && (
              <View style={styles.tableTotalRow}>
                <Text style={styles.tableTotalLabel}>지출 합계</Text>
                <Text style={styles.tableTotalValue}>
                  {yearCardStats.totalExpense.toLocaleString()} 원
                </Text>
              </View>
            )}
          </View>

          {/* 하단 영역 2: 연도별 적금/저축 합계 표 (지출 합계 밑 영역) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🏦 {selectedYearTab}년 적금/저축 합계</Text>

            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 2 }]}>적금 항목 / 사용처</Text>
              <Text style={[styles.th, { flex: 2 }]}>적금 금액</Text>
              <Text style={[styles.th, { flex: 1 }]}>비율</Text>
            </View>

            {yearSavingsStats.list.length > 0 ? (
              yearSavingsStats.list.map((item) => (
                <View key={item.name} style={styles.tableRow}>
                  <Text style={[styles.tdBold, { flex: 2 }]}>{item.name}</Text>
                  <Text style={[styles.tdSavings, { flex: 2 }]}>
                    {item.amount.toLocaleString()} 원
                  </Text>
                  <Text style={[styles.tdPercent, { flex: 1 }]}>{item.percentage}%</Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyTableBox}>
                <Text style={styles.emptyTableText}>
                  {selectedYearTab}년 적금/저축 내역이 없습니다.
                </Text>
              </View>
            )}

            {yearSavingsStats.list.length > 0 && (
              <View style={styles.tableTotalRow}>
                <Text style={styles.tableTotalLabel}>적금 합계</Text>
                <Text style={styles.tableTotalSavingsValue}>
                  {yearSavingsStats.totalSavings.toLocaleString()} 원
                </Text>
              </View>
            )}
          </View>
        </View>
      )}
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
  yearPickerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  yearTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#212121',
  },
  arrowBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    elevation: 2,
  },
  arrowBtnDisabled: {
    backgroundColor: '#F0F0F0',
    elevation: 0,
  },
  arrowText: {
    fontSize: 14,
    color: '#2196F3',
    fontWeight: 'bold',
  },
  arrowTextDisabled: {
    color: '#BDBDBD',
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#E0E0E0',
    borderRadius: 8,
    padding: 2,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
  },
  activeTabBtn: {
    backgroundColor: '#FFFFFF',
  },
  tabBtnText: {
    fontSize: 14,
    color: '#666666',
    fontWeight: '500',
  },
  activeTabBtnText: {
    color: '#2196F3',
    fontWeight: 'bold',
  },
  /* 예산 요약 카드 */
  budgetSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  budgetSummaryTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 12,
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  balanceRow: {
    borderBottomWidth: 0,
    paddingTop: 10,
    marginTop: 2,
  },
  budgetLabel: {
    fontSize: 13,
    color: '#616161',
  },
  budgetValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#212121',
  },
  balanceLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#212121',
  },
  balanceValue: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 12,
  },
  summaryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  label: {
    fontSize: 14,
    color: '#666666',
  },
  valueExpense: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#D32F2F',
  },
  valueSavings: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1976D2',
  },
  /* 1~12월 스크롤 탭 */
  monthScrollTab: {
    marginBottom: 12,
  },
  monthScrollContent: {
    gap: 6,
  },
  monthChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  selectedMonthChip: {
    backgroundColor: '#E3F2FD',
    borderColor: '#2196F3',
  },
  monthChipText: {
    fontSize: 13,
    color: '#616161',
  },
  selectedMonthChipText: {
    color: '#1976D2',
    fontWeight: 'bold',
  },
  /* 연도 탭 */
  yearTabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  yearChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    alignItems: 'center',
  },
  selectedYearChip: {
    backgroundColor: '#E3F2FD',
    borderColor: '#2196F3',
  },
  yearChipText: {
    fontSize: 13,
    color: '#616161',
  },
  selectedYearChipText: {
    color: '#1976D2',
    fontWeight: 'bold',
  },
  /* 테이블 스타일 */
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#FAFAFA',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    borderRadius: 4,
  },
  th: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#666666',
    textAlign: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
    alignItems: 'center',
  },
  tdBold: {
    fontSize: 13,
    fontWeight: '600',
    color: '#212121',
  },
  tdExpense: {
    fontSize: 13,
    color: '#D32F2F',
    fontWeight: 'bold',
    textAlign: 'right',
  },
  tdPercent: {
    fontSize: 12,
    color: '#757575',
    textAlign: 'right',
  },
  tdSavings: {
    fontSize: 13,
    color: '#1976D2',
    fontWeight: 'bold',
    textAlign: 'right',
  },
  tableTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    marginTop: 4,
    borderTopWidth: 2,
    borderTopColor: '#212121',
  },
  tableTotalLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#212121',
  },
  tableTotalValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#D32F2F',
  },
  tableTotalSavingsValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1976D2',
  },
  emptyTableBox: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyTableText: {
    fontSize: 13,
    color: '#9E9E9E',
  },
});
