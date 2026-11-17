import dayjs from 'dayjs';
import { CategoryType } from '../types/budget';
import { holidayDao } from '../database/holidayDao';

const parseUtcYmd = (dateStr: string): Date | null => {
  if (dateStr.length !== 10 || dateStr[4] !== '-' || dateStr[7] !== '-') {
    return null;
  }
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  const d = Number(dateStr.slice(8, 10));
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  return new Date(Date.UTC(y, m - 1, d));
};

const formatUtcYmd = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const isWeekend = (dateStr: string): boolean => {
  try {
    const utcDate = parseUtcYmd(dateStr);
    const day = utcDate ? utcDate.getUTCDay() : dayjs(dateStr).day();
    return day === 0 || day === 6; // 0: 일요일, 6: 토요일
  } catch (e) {
    return false;
  }
};

export const isHoliday = (dateStr: string): boolean => {
  try {
    return holidayDao.isHoliday(dateStr);
  } catch (e) {
    return false;
  }
};

export const isRedDay = (dateStr: string): boolean => {
  return isWeekend(dateStr) || isHoliday(dateStr);
};

export const getNextBusinessDay = (
  dateStr: string,
  categoryType: CategoryType
): string => {
  if (categoryType === 'SAVINGS') {
    return dateStr;
  }

  try {
    const utcDate = parseUtcYmd(dateStr);
    if (utcDate) {
      let timeMs = utcDate.getTime();
      let maxLoop = 0;
      while (maxLoop < 14) {
        const cur = new Date(timeMs);
        const day = cur.getUTCDay();
        const curStr = formatUtcYmd(cur);
        if (day !== 0 && day !== 6 && !isHoliday(curStr)) {
          return curStr;
        }
        timeMs += 86400000;
        maxLoop++;
      }
      return formatUtcYmd(new Date(timeMs));
    }

    let current = dayjs(dateStr);
    let maxLoop = 0;
    while (isRedDay(current.format('YYYY-MM-DD')) && maxLoop < 14) {
      current = current.add(1, 'day');
      maxLoop++;
    }
    return current.format('YYYY-MM-DD');
  } catch (e) {
    return dateStr;
  }
};
