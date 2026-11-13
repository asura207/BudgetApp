import { NativeModules } from 'react-native';
import { safeDbExecute } from './db';

const { SmsHistoryParserModule } = NativeModules;

export interface AppNotificationRaw {
  id: string;
  packageName: string;
  title: string;
  text: string;
  bigText: string;
  rawContent: string;
  postTime: string;
  isBookmarked: boolean;
  createdAt?: string;
}

export const appNotificationDao = {
  getRecentNotifications(): AppNotificationRaw[] {
    try {
      safeDbExecute(`
        CREATE TABLE IF NOT EXISTS app_notifications_raw (
          id TEXT PRIMARY KEY NOT NULL,
          package_name TEXT NOT NULL,
          title TEXT,
          text TEXT,
          big_text TEXT,
          raw_content TEXT NOT NULL,
          post_time TEXT NOT NULL,
          is_bookmarked BOOLEAN DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (e) {}

    try {
      safeDbExecute('ALTER TABLE app_notifications_raw ADD COLUMN is_bookmarked BOOLEAN DEFAULT 0;');
    } catch (e) {}

    // 무효 앱 푸시 일괄 정제 소제 실행
    try {
      safeDbExecute("DELETE FROM app_notifications_raw WHERE package_name = 'com.android.systemui';");
      safeDbExecute("DELETE FROM app_notifications_raw WHERE package_name = 'com.google.android.apps.youtube.music';");
      safeDbExecute("DELETE FROM app_notifications_raw WHERE package_name = 'com.android.vending';");
      safeDbExecute("DELETE FROM app_notifications_raw WHERE package_name = 'com.lguplus.aicallagent';");
      safeDbExecute("DELETE FROM app_notifications_raw WHERE package_name = 'android' AND (title LIKE '%플레이오%' OR raw_content LIKE '%플레이오%');");
      safeDbExecute("DELETE FROM app_notifications_raw WHERE (LOWER(package_name) LIKE '%toss%' OR LOWER(package_name) LIKE '%kakaopay%') AND (title LIKE '%걸음%' OR raw_content LIKE '%걸음%' OR title LIKE '%만보기%');");
      safeDbExecute("DELETE FROM app_notifications_raw WHERE LOWER(package_name) LIKE '%toss%' AND (title LIKE '%악성%' OR raw_content LIKE '%악성%');");
    } catch (e) {}

    // 1달 이상 된 오래된 푸시 알림 중 미보관(is_bookmarked=0) 항목만 자동 청소
    try {
      safeDbExecute("DELETE FROM app_notifications_raw WHERE post_time < datetime('now', '-30 days') AND (is_bookmarked = 0 OR is_bookmarked IS NULL);");
    } catch (e) {}

    const resultMap = new Map<string, AppNotificationRaw>();

    try {
      const result = safeDbExecute(
        "SELECT id, package_name, title, text, big_text, raw_content, post_time, is_bookmarked, created_at FROM app_notifications_raw WHERE package_name != 'com.android.systemui' AND package_name != 'com.google.android.apps.youtube.music' AND package_name != 'com.android.vending' AND package_name != 'com.lguplus.aicallagent' AND NOT (package_name = 'android' AND (title LIKE '%플레이오%' OR raw_content LIKE '%플레이오%')) ORDER BY post_time DESC;"
      );
      const rows = result?.rows?._array || [];
      rows.forEach((r: any) => {
        resultMap.set(r.id, {
          id: r.id,
          packageName: r.package_name || '',
          title: r.title || '',
          text: r.text || '',
          bigText: r.big_text || '',
          rawContent: r.raw_content || '',
          postTime: r.post_time || '',
          isBookmarked: Boolean(r.is_bookmarked),
          createdAt: r.created_at,
        });
      });
    } catch (e) {
      console.warn('getRecentNotifications query error:', e);
    }

    return Array.from(resultMap.values()).sort((a, b) => b.postTime.localeCompare(a.postTime));
  },

  async syncNativeBufferToDb(): Promise<AppNotificationRaw[]> {
    try {
      if (SmsHistoryParserModule && typeof SmsHistoryParserModule.getAppNotificationsBuffer === 'function') {
        const rawJsonStr = await SmsHistoryParserModule.getAppNotificationsBuffer();
        if (rawJsonStr && rawJsonStr !== '[]') {
          const list = JSON.parse(rawJsonStr);
          if (Array.isArray(list)) {
            list.forEach((item: any) => {
              const pkg = (item.package_name || item.packageName || '').toLowerCase();
              const content = item.raw_content || item.rawContent || '';
              const title = item.title || '';

              if (pkg === 'com.android.systemui') return;
              if (pkg === 'com.google.android.apps.youtube.music') return;
              if (pkg === 'com.android.vending') return;
              if (pkg === 'com.lguplus.aicallagent') return;
              if (pkg === 'android' && (title.includes('플레이오') || content.includes('플레이오'))) return;
              if ((pkg.includes('toss') || pkg.includes('kakaopay')) && (title.includes('걸음') || content.includes('걸음') || title.includes('만보기'))) return;
              if (pkg.includes('toss') && (title.includes('악성') || content.includes('악성'))) return;

              const isBookmarked = item.is_bookmarked || item.isBookmarked ? 1 : 0;
              const postTime = item.post_time || item.postTime || '';
              const postDate = postTime.length >= 10 ? postTime.substring(0, 10) : '';

              try {
                // 동일 발신 앱, 동일 일자, 동일 제목/원문 중복 수집 차단
                if (postDate) {
                  const dupRes = safeDbExecute(
                    `SELECT id, raw_content FROM app_notifications_raw
                     WHERE LOWER(package_name) = ? AND substr(post_time, 1, 10) = ? AND COALESCE(title, '') = ?;`,
                    [pkg, postDate, title]
                  );
                  const existingRows = dupRes?.rows?._array || [];
                  const hasExactContentDup = existingRows.some(
                    (row: any) => (row.raw_content || '') === content
                  );
                  if (hasExactContentDup) return;
                  // 비결제 일반 알림은 동일 앱/당일/동일 제목 중복 스킵
                  if (isBookmarked === 0 && existingRows.length > 0) return;
                }

                safeDbExecute(
                  'INSERT OR IGNORE INTO app_notifications_raw (id, package_name, title, text, big_text, raw_content, post_time, is_bookmarked) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
                  [
                    item.id || `${Date.now()}_${Math.random()}`,
                    pkg,
                    title,
                    item.text || '',
                    item.big_text || item.bigText || '',
                    content,
                    postTime,
                    isBookmarked,
                  ]
                );
              } catch (err) {}
            });
          }
        }
      }
    } catch (e) {
      console.warn('syncNativeBufferToDb error:', e);
    }

    return this.getRecentNotifications();
  },

  toggleBookmark(id: string, isBookmarked: boolean): void {
    try {
      safeDbExecute('UPDATE app_notifications_raw SET is_bookmarked = ? WHERE id = ?;', [
        isBookmarked ? 1 : 0,
        id,
      ]);
    } catch (e) {}
  },

  deleteNotification(id: string): void {
    try {
      safeDbExecute('DELETE FROM app_notifications_raw WHERE id = ?;', [id]);
      if (SmsHistoryParserModule && typeof SmsHistoryParserModule.clearAppNotificationsBuffer === 'function') {
        SmsHistoryParserModule.clearAppNotificationsBuffer(id);
      }
    } catch (e) {}
  },

  clearAllNotifications(): void {
    try {
      // 보관된 항목(is_bookmarked=1)은 삭제하지 않고 미보관 항목만 삭제
      safeDbExecute('DELETE FROM app_notifications_raw WHERE is_bookmarked = 0 OR is_bookmarked IS NULL;');
      if (SmsHistoryParserModule && typeof SmsHistoryParserModule.clearAppNotificationsBuffer === 'function') {
        SmsHistoryParserModule.clearAppNotificationsBuffer('CLEAR_ALL');
      }
    } catch (e) {}
  },
};
