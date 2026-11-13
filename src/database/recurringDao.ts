import { DeviceEventEmitter } from 'react-native';
import dayjs from 'dayjs';
import { safeDbExecute } from './db';
import { RecurringRule, RepeatType } from '../types/budget';

export const recurringDao = {
  insertRecurringRule(rule: RecurringRule): void {
    const startDate = rule.startDate || dayjs().format('YYYY-MM-DD');
    const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');
    const daysOfWeekJson = JSON.stringify(rule.daysOfWeek || []);

    safeDbExecute(
      `INSERT OR REPLACE INTO recurring_rules (id, day_of_month, is_daily, repeat_type, days_of_week, start_date, category_type, amount, merchant, payment_type, card_company, installment_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        rule.id,
        rule.dayOfMonth,
        rule.isDaily ? 1 : 0,
        repeatType,
        daysOfWeekJson,
        startDate,
        rule.categoryType,
        rule.amount,
        rule.merchant,
        rule.paymentType,
        rule.cardCompany || null,
        rule.installmentType,
      ]
    );
    DeviceEventEmitter.emit('TRANSACTION_UPDATED');
  },

  updateRecurringRule(rule: RecurringRule): void {
    const startDate = rule.startDate || dayjs().format('YYYY-MM-DD');
    const repeatType = rule.repeatType || (rule.isDaily ? 'DAILY' : 'MONTHLY_DAY');
    const daysOfWeekJson = JSON.stringify(rule.daysOfWeek || []);

    safeDbExecute(
      `UPDATE recurring_rules
       SET day_of_month = ?, is_daily = ?, repeat_type = ?, days_of_week = ?, start_date = ?, category_type = ?, amount = ?, merchant = ?, payment_type = ?, card_company = ?, installment_type = ?
       WHERE id = ?;`,
      [
        rule.dayOfMonth,
        rule.isDaily ? 1 : 0,
        repeatType,
        daysOfWeekJson,
        startDate,
        rule.categoryType,
        rule.amount,
        rule.merchant,
        rule.paymentType,
        rule.cardCompany || null,
        rule.installmentType,
        rule.id,
      ]
    );
    DeviceEventEmitter.emit('TRANSACTION_UPDATED');
  },

  deleteRecurringRule(id: string): void {
    safeDbExecute('DELETE FROM recurring_rules WHERE id = ?;', [id]);
    DeviceEventEmitter.emit('TRANSACTION_UPDATED');
  },

  getAllRecurringRules(): RecurringRule[] {
    const result = safeDbExecute('SELECT * FROM recurring_rules ORDER BY day_of_month ASC;');
    const rows = result.rows?._array || [];
    return rows.map((row: any) => {
      let daysOfWeek: number[] = [];
      try {
        if (row.days_of_week) {
          daysOfWeek = JSON.parse(row.days_of_week);
        }
      } catch (e) {
        daysOfWeek = [];
      }

      const repeatType: RepeatType = (row.repeat_type as RepeatType) || (row.is_daily ? 'DAILY' : 'MONTHLY_DAY');

      return {
        id: row.id,
        dayOfMonth: row.day_of_month,
        isDaily: Boolean(row.is_daily),
        repeatType,
        daysOfWeek,
        startDate: row.start_date || dayjs().format('YYYY-MM-DD'),
        categoryType: row.category_type,
        amount: row.amount,
        merchant: row.merchant,
        paymentType: row.payment_type,
        cardCompany: row.card_company || undefined,
        installmentType: row.installment_type,
        createdAt: row.created_at,
      };
    });
  },
};
