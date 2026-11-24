import { RecurringRule } from '../types/budget';
import { getNextBusinessDay } from './dateUtils';

export interface RecurringOccurrence {
  rule: RecurringRule;
  rawDate: string;
  effectiveDate: string;
}

const DAY_MS = 86400000;

const formatUtcYmd = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * 지정한 월(YYYY-MM)에 실제로 도래하는 정기 결제/적금 내역을 산출합니다.
 * 전월 말(최대 14일 전)의 주말/공휴일 이관분이 당월로 넘어오는 경우를 포함하며,
 * 당월 말의 지출이 익월로 이관되는 경우는 익월로 넘깁니다.
 */
export const getRecurringOccurrencesForMonth = (
  rules: RecurringRule[],
  yearMonth: string,
  maxEffectiveDate?: string
): RecurringOccurrence[] => {
  if (rules.length === 0) return [];

  const yearNum = Number(yearMonth.slice(0, 4));
  const monthNum = Number(yearMonth.slice(5, 7));
  if (isNaN(yearNum) || isNaN(monthNum)) return [];

  const monthStartMs = Date.UTC(yearNum, monthNum - 1, 1);
  const monthEndMs = Date.UTC(yearNum, monthNum, 0);
  const scanStartMs = monthStartMs - 14 * DAY_MS;

  // 스캔 구간의 날짜 메타(문자열/일/요일)를 1회만 생성해 모든 규칙이 공유
  const calendarDays: { rawDate: string; dayOfMonth: number; dayOfWeek: number }[] = [];
  for (let ms = scanStartMs; ms <= monthEndMs; ms += DAY_MS) {
    const dt = new Date(ms);
    calendarDays.push({
      rawDate: formatUtcYmd(dt),
      dayOfMonth: dt.getUTCDate(),
      dayOfWeek: dt.getUTCDay(),
    });
  }

  // 지출 영업일 이관 결과를 동일 날짜에 대해 재계산하지 않도록 캐싱
  const expenseEffectiveCache: { [rawDate: string]: string } = {};
  const occurrences: RecurringOccurrence[] = [];

  for (let rIdx = 0; rIdx < rules.length; rIdx++) {
    const rule = rules[rIdx];
    const ruleStartStr = (rule.startDate || rule.createdAt || `${yearMonth}-01`).slice(0, 10);
    const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');
    // 매월 지정일(MONTHLY_DAY) 지출만 비영업일(주말/공휴일) 시 다음 영업일로 이관
    // 특정 요일(WEEKLY_DAYS: 매주 토요일 등)과 매일 반복(DAILY)은 사용자가 지정한 요일/날짜에 그대로 표시
    const shouldRolloverToBusinessDay =
      rule.categoryType === 'EXPENSE' && repeatType === 'MONTHLY_DAY';
    const daysOfWeekSet =
      repeatType === 'WEEKLY_DAYS'
        ? new Set((rule.daysOfWeek || []).map((d) => Number(d)))
        : null;

    for (let dIdx = 0; dIdx < calendarDays.length; dIdx++) {
      const { rawDate, dayOfMonth, dayOfWeek } = calendarDays[dIdx];
      if (rawDate < ruleStartStr) continue;

      let applies = false;
      if (repeatType === 'DAILY') {
        applies = true;
      } else if (repeatType === 'MONTHLY_DAY') {
        applies = dayOfMonth === rule.dayOfMonth;
      } else if (repeatType === 'WEEKLY_DAYS') {
        applies = daysOfWeekSet !== null && daysOfWeekSet.has(dayOfWeek);
      }

      if (!applies) continue;

      let effectiveDate = rawDate;
      if (shouldRolloverToBusinessDay) {
        effectiveDate = expenseEffectiveCache[rawDate];
        if (!effectiveDate) {
          effectiveDate = getNextBusinessDay(rawDate, 'EXPENSE');
          expenseEffectiveCache[rawDate] = effectiveDate;
        }
      }

      if (effectiveDate.startsWith(yearMonth)) {
        if (!maxEffectiveDate || effectiveDate <= maxEffectiveDate) {
          occurrences.push({ rule, rawDate, effectiveDate });
        }
      }
    }
  }

  return occurrences;
};

