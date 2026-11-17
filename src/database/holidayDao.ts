import { safeDbExecute } from './db';
import { Holiday } from '../types/budget';

// 공휴일 여부 O(1) 조회를 위한 인메모리 캐시 (갱신/삭제 시 자동 무효화)
let holidaySetCache: Set<string> | null = null;

export const holidayDao = {
  invalidateCache(): void {
    holidaySetCache = null;
  },

  upsertHoliday(h: Holiday): void {
    safeDbExecute(
      `INSERT INTO holidays (locdate, date_name, is_holiday, is_custom)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(locdate) DO UPDATE SET
         date_name = excluded.date_name,
         is_holiday = excluded.is_holiday,
         is_custom = excluded.is_custom,
         updated_at = CURRENT_TIMESTAMP
       WHERE holidays.is_custom = 0 OR excluded.is_custom = 1;`,
      [h.locdate, h.dateName, h.isHoliday ? 1 : 0, h.isCustom ? 1 : 0]
    );
    holidaySetCache = null;
  },

  deleteCustomHoliday(locdate: string): void {
    safeDbExecute('DELETE FROM holidays WHERE locdate = ? AND is_custom = 1;', [locdate]);
    holidaySetCache = null;
  },

  getAllCustomHolidays(): Holiday[] {
    const result = safeDbExecute(
      'SELECT * FROM holidays WHERE is_custom = 1 ORDER BY locdate DESC;'
    );
    const rows = result.rows?._array || [];
    return rows.map((row: any) => ({
      locdate: row.locdate,
      dateName: row.date_name,
      isHoliday: Boolean(row.is_holiday),
      isCustom: Boolean(row.is_custom),
      updatedAt: row.updated_at,
    }));
  },

  updateCustomHoliday(oldLocdate: string, newHoliday: Holiday): void {
    if (oldLocdate !== newHoliday.locdate) {
      safeDbExecute('DELETE FROM holidays WHERE locdate = ? AND is_custom = 1;', [oldLocdate]);
      holidaySetCache = null;
    }
    this.upsertHoliday(newHoliday);
  },

  getHolidaysByYear(yearStr: string): Holiday[] {
    const result = safeDbExecute(
      'SELECT * FROM holidays WHERE locdate LIKE ? ORDER BY locdate ASC;',
      [`${yearStr}%`]
    );
    const rows = result.rows?._array || [];
    return rows.map((row: any) => ({
      locdate: row.locdate,
      dateName: row.date_name,
      isHoliday: Boolean(row.is_holiday),
      isCustom: Boolean(row.is_custom),
      updatedAt: row.updated_at,
    }));
  },

  isHoliday(dateStr: string): boolean {
    if (holidaySetCache === null) {
      const result = safeDbExecute(
        'SELECT locdate FROM holidays WHERE is_holiday = 1;'
      );
      const rows = result.rows?._array || [];
      holidaySetCache = new Set<string>(rows.map((row: any) => String(row.locdate)));
    }
    return holidaySetCache.has(dateStr);
  },
};
