import { DeviceEventEmitter } from 'react-native';
import { safeDbExecute } from './db';
import { Transaction } from '../types/budget';
import { parseExceptionDao } from './parseExceptionDao';

export const transactionDao = {
  insertTransaction(tx: Transaction): void {
    // 예외 처리 관리 DB(parse_exceptions)에서 동적 키워드 리스트를 읽어와 파싱 예외 처리 (applySms가 true인 예외 단어만 차단)
    const exceptions = parseExceptionDao.getAllExceptions();
    const isExcluded = exceptions.some(
      (e) => e.keyword && e.applySms && tx.merchant.includes(e.keyword)
    );
    if (isExcluded) {
      console.log(`⚠️ DB 파싱 예외 단어 매칭 차단: ${tx.merchant}`);
      return;
    }

    // 중복 체크: 시분초(created_at) OR 날짜(date), 사용처(merchant), 금액(amount)이 동일한 기존 기록이 있는지 확인
    if (tx.createdAt) {
      const dupCheck = safeDbExecute(
        'SELECT COUNT(*) as count FROM transactions WHERE merchant = ? AND amount = ? AND created_at = ?;',
        [tx.merchant, tx.amount, tx.createdAt]
      );
      const cnt = dupCheck.rows?._array?.[0]?.count || 0;
      if (cnt > 0) {
        console.log(
          `⚠️ 동일한 결제 내역(시분초:${tx.createdAt}, 사용처:${tx.merchant}, 금액:${tx.amount})이 이미 존재하여 중복 추가를 방지했습니다.`
        );
        return;
      }
    } else {
      const dupCheck = safeDbExecute(
        'SELECT COUNT(*) as count FROM transactions WHERE merchant = ? AND amount = ? AND date = ?;',
        [tx.merchant, tx.amount, tx.date]
      );
      const cnt = dupCheck.rows?._array?.[0]?.count || 0;
      if (cnt > 0) {
        console.log(
          `⚠️ 동일한 결제 내역(일자:${tx.date}, 사용처:${tx.merchant}, 금액:${tx.amount})이 이미 존재하여 중복 추가를 방지했습니다.`
        );
        return;
      }
    }

    if (tx.createdAt) {
      safeDbExecute(
        `INSERT INTO transactions (id, date, category_type, amount, merchant, payment_type, card_company, installment_type, installment_months, is_recurring, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          tx.id,
          tx.date,
          tx.categoryType,
          tx.amount,
          tx.merchant,
          tx.paymentType,
          tx.cardCompany || null,
          tx.installmentType,
          tx.installmentMonths,
          tx.isRecurring ? 1 : 0,
          tx.createdAt,
        ]
      );
    } else {
      safeDbExecute(
        `INSERT INTO transactions (id, date, category_type, amount, merchant, payment_type, card_company, installment_type, installment_months, is_recurring)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          tx.id,
          tx.date,
          tx.categoryType,
          tx.amount,
          tx.merchant,
          tx.paymentType,
          tx.cardCompany || null,
          tx.installmentType,
          tx.installmentMonths,
          tx.isRecurring ? 1 : 0,
        ]
      );
    }
    DeviceEventEmitter.emit('TRANSACTION_UPDATED');
  },

  updateTransaction(tx: Transaction): void {
    safeDbExecute(
      `UPDATE transactions
       SET date = ?, category_type = ?, amount = ?, merchant = ?, payment_type = ?, card_company = ?, installment_type = ?, installment_months = ?, is_recurring = ?
       WHERE id = ?;`,
      [
        tx.date,
        tx.categoryType,
        tx.amount,
        tx.merchant,
        tx.paymentType,
        tx.cardCompany || null,
        tx.installmentType,
        tx.installmentMonths,
        tx.isRecurring ? 1 : 0,
        tx.id,
      ]
    );
    DeviceEventEmitter.emit('TRANSACTION_UPDATED');
  },

  deleteTransaction(id: string): void {
    safeDbExecute('DELETE FROM transactions WHERE id = ?;', [id]);
    DeviceEventEmitter.emit('TRANSACTION_UPDATED');
  },

  deleteTransactionsByKeyword(keyword: string): number {
    const trimmed = keyword.trim();
    if (!trimmed) return 0;

    // 해당 키워드의 applySms가 false인 경우 (문자는 허용) DB에서 삭제하지 않음
    const exceptions = parseExceptionDao.getAllExceptions();
    const targetRule = exceptions.find((e) => e.keyword === trimmed);
    if (targetRule && !targetRule.applySms) {
      console.log(`⚠️ applySms가 false인 키워드('${trimmed}')는 DB 이력 삭제 스킵`);
      return 0;
    }

    try {
      const res = safeDbExecute('DELETE FROM transactions WHERE merchant LIKE ? OR card_company LIKE ?;', [
        `%${trimmed}%`,
        `%${trimmed}%`,
      ]);
      DeviceEventEmitter.emit('TRANSACTION_UPDATED');
      return res.rowsAffected || 0;
    } catch (e) {
      return 0;
    }
  },

  purgeAllExceptionMatchedTransactions(): number {
    const parseExceptions = parseExceptionDao.getAllExceptions();
    let totalPurged = 0;

    parseExceptions.forEach((e) => {
      // applySms가 true인 예외 단어만 SMS 거래 내역에서 삭제 (applySms가 false인 네이버페이는 보존)
      if (e.keyword && e.keyword.trim() && e.applySms) {
        try {
          const res = safeDbExecute(
            'DELETE FROM transactions WHERE merchant LIKE ? OR card_company LIKE ?;',
            [`%${e.keyword.trim()}%`, `%${e.keyword.trim()}%`]
          );
          totalPurged += res.rowsAffected || 0;
        } catch (err) {}
      }
    });

    if (totalPurged > 0) {
      DeviceEventEmitter.emit('TRANSACTION_UPDATED');
    }

    return totalPurged;
  },

  getTransactionsByDate(dateStr: string): Transaction[] {
    const result = safeDbExecute(
      'SELECT * FROM transactions WHERE date = ? ORDER BY created_at DESC;',
      [dateStr]
    );

    const rows = result.rows?._array || [];
    return rows.map((row: any) => ({
      id: row.id,
      date: row.date,
      categoryType: row.category_type,
      amount: row.amount,
      merchant: row.merchant,
      paymentType: row.payment_type,
      cardCompany: row.card_company || undefined,
      installmentType: row.installment_type,
      installmentMonths: row.installment_months,
      isRecurring: Boolean(row.is_recurring),
      createdAt: row.created_at,
    }));
  },

  getTransactionsByMonth(yearMonthStr: string): Transaction[] {
    const result = safeDbExecute(
      'SELECT * FROM transactions WHERE date LIKE ? ORDER BY date ASC;',
      [`${yearMonthStr}%`]
    );

    const rows = result.rows?._array || [];
    return rows.map((row: any) => ({
      id: row.id,
      date: row.date,
      categoryType: row.category_type,
      amount: row.amount,
      merchant: row.merchant,
      paymentType: row.payment_type,
      cardCompany: row.card_company || undefined,
      installmentType: row.installment_type,
      installmentMonths: row.installment_months,
      isRecurring: Boolean(row.is_recurring),
      createdAt: row.created_at,
    }));
  },

  getTransactionsByYear(yearStr: string): Transaction[] {
    const result = safeDbExecute(
      'SELECT * FROM transactions WHERE date LIKE ? ORDER BY date ASC;',
      [`${yearStr}%`]
    );

    const rows = result.rows?._array || [];
    return rows.map((row: any) => ({
      id: row.id,
      date: row.date,
      categoryType: row.category_type,
      amount: row.amount,
      merchant: row.merchant,
      paymentType: row.payment_type,
      cardCompany: row.card_company || undefined,
      installmentType: row.installment_type,
      installmentMonths: row.installment_months,
      isRecurring: Boolean(row.is_recurring),
      createdAt: row.created_at,
    }));
  },

  getAllInstallmentTransactions(): Transaction[] {
    const result = safeDbExecute(
      "SELECT * FROM transactions WHERE category_type = 'EXPENSE' AND installment_type = 'INSTALLMENT' AND installment_months > 1 ORDER BY date ASC;"
    );

    const rows = result.rows?._array || [];
    return rows.map((row: any) => ({
      id: row.id,
      date: row.date,
      categoryType: row.category_type,
      amount: row.amount,
      merchant: row.merchant,
      paymentType: row.payment_type,
      cardCompany: row.card_company || undefined,
      installmentType: row.installment_type,
      installmentMonths: row.installment_months,
      isRecurring: Boolean(row.is_recurring),
      createdAt: row.created_at,
    }));
  },
};
