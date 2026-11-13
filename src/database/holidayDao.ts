import { safeDbExecute } from './db';
import { Holiday } from '../types/budget';

export const holidayDao = {
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
  },

  deleteCustomHoliday(locdate: string): void {
    safeDbExecute('DELETE FROM holidays WHERE locdate = ? AND is_custom = 1;', [locdate]);
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
    const result = safeDbExecute(
      'SELECT is_holiday FROM holidays WHERE locdate = ? LIMIT 1;',
      [dateStr]
    );
    const rows = result.rows?._array || [];
    if (rows.length > 0) {
      return Boolean(rows[0].is_holiday);
    }
    return false;
  },
};
