import { safeDbExecute } from './db';

export interface ParseException {
  id: string;
  keyword: string;
  applyPush: boolean;
  applySms: boolean;
  createdAt?: string;
}

export const parseExceptionDao = {
  getAllExceptions(): ParseException[] {
    const result = safeDbExecute('SELECT * FROM parse_exceptions ORDER BY created_at ASC;');
    const rows = result.rows?._array || [];
    return rows.map((r: any) => ({
      id: r.id,
      keyword: r.keyword,
      applyPush: r.apply_push === undefined || r.apply_push === null ? true : Boolean(r.apply_push),
      applySms: r.apply_sms === undefined || r.apply_sms === null ? true : Boolean(r.apply_sms),
      createdAt: r.created_at,
    }));
  },

  insertException(keyword: string, applyPush: boolean, applySms: boolean): boolean {
    const trimmed = keyword.trim();
    if (!trimmed) return false;
    try {
      const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      safeDbExecute(
        `INSERT INTO parse_exceptions (id, keyword, apply_push, apply_sms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(keyword) DO UPDATE SET
           apply_push = excluded.apply_push,
           apply_sms = excluded.apply_sms;`,
        [uniqueId, trimmed, applyPush ? 1 : 0, applySms ? 1 : 0]
      );
      return true;
    } catch (e) {
      return false;
    }
  },

  updateException(id: string, keyword: string, applyPush: boolean, applySms: boolean): boolean {
    const trimmed = keyword.trim();
    if (!trimmed) return false;
    try {
      safeDbExecute(
        'UPDATE parse_exceptions SET keyword = ?, apply_push = ?, apply_sms = ? WHERE id = ?;',
        [trimmed, applyPush ? 1 : 0, applySms ? 1 : 0, id]
      );
      return true;
    } catch (e) {
      return false;
    }
  },

  deleteException(id: string): void {
    safeDbExecute('DELETE FROM parse_exceptions WHERE id = ?;', [id]);
  },
};
