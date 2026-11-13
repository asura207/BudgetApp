import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import { RecurringRule } from '../types/budget';
import { getNextBusinessDay } from './dateUtils';

dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

export interface RecurringOccurrence {
  rule: RecurringRule;
  rawDate: string;
  effectiveDate: string;
}

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
  const monthStart = dayjs(`${yearMonth}-01`, 'YYYY-MM-DD');
  const monthEnd = monthStart.endOf('month');
  const scanStart = monthStart.subtract(14, 'day');
  const maxMoment = maxEffectiveDate ? dayjs(maxEffectiveDate, 'YYYY-MM-DD') : null;

  const occurrences: RecurringOccurrence[] = [];

  rules.forEach((rule) => {
    const ruleStartStr = rule.startDate || rule.createdAt?.slice(0, 10) || `${yearMonth}-01`;
    const ruleStartMoment = dayjs(ruleStartStr, 'YYYY-MM-DD');
    const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');

    let cursor = scanStart;
    while (cursor.isSameOrBefore(monthEnd, 'day')) {
      const rawDate = cursor.format('YYYY-MM-DD');

      if (cursor.isSameOrAfter(ruleStartMoment, 'day')) {
        let applies = false;
        if (repeatType === 'DAILY') {
          applies = true;
        } else if (repeatType === 'MONTHLY_DAY') {
          applies = cursor.date() === rule.dayOfMonth;
        } else if (repeatType === 'WEEKLY_DAYS') {
          applies = (rule.daysOfWeek || []).includes(cursor.day());
        }

        if (applies) {
          const effectiveDate =
            rule.categoryType === 'EXPENSE'
              ? getNextBusinessDay(rawDate, 'EXPENSE')
              : rawDate;

          if (effectiveDate.startsWith(yearMonth)) {
            if (!maxMoment || dayjs(effectiveDate, 'YYYY-MM-DD').isSameOrBefore(maxMoment, 'day')) {
              occurrences.push({ rule, rawDate, effectiveDate });
            }
          }
        }
      }

      cursor = cursor.add(1, 'day');
    }
  });

  return occurrences;
};

