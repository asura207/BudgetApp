import dayjs from 'dayjs';
import { holidayDao } from '../database/holidayDao';
import { getFallbackHolidaysForYear } from '../utils/fallbackHolidays';
import { getLastHolidaySync, setLastHolidaySync } from '../storage/mmkv';
import { Holiday } from '../types/budget';

const PUBLIC_HOLIDAY_API = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
// 서비스 키 (필요시 대체 가능하도록 설정)
const API_KEY = 'bf09ccab001ebac6d639311400710826a9c70ba4f7deff2a5f671a99dfce9335';

export const holidayService = {
  seedFallbackHolidays(year: number = dayjs().year()): void {
    getFallbackHolidaysForYear(year).forEach((h) => {
      holidayDao.upsertHoliday(h);
    });
  },

  async syncHolidays(year: number): Promise<boolean> {
    try {
      const url = `${PUBLIC_HOLIDAY_API}?solYear=${year}&ServiceKey=${API_KEY}&_type=json&numOfRows=100`;
      const response = await fetch(url, { method: 'GET' });

      if (!response.ok) {
        throw new Error(`API response failed with status ${response.status}`);
      }

      const json = await response.json();
      const rawItems = json?.response?.body?.items?.item;
      const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

      if (items.length > 0) {
        items.forEach((item: any) => {
          if (!item?.locdate) return;
          const rawDate = String(item.locdate);
          const formattedDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
          const holiday: Holiday = {
            locdate: formattedDate,
            dateName: item.dateName || '공휴일',
            isHoliday: item.isHoliday === 'Y' || item.isHoliday === true,
            isCustom: false,
          };
          holidayDao.upsertHoliday(holiday);
        });
      } else {
        this.seedFallbackHolidays(year);
      }

      setLastHolidaySync(new Date().toISOString());
      return true;
    } catch (error) {
      console.warn('Holiday API fetch failed, seeding fallback holidays:', error);
      this.seedFallbackHolidays(year);
      return false;
    }
  },

  async ensureHolidaysInitialized(): Promise<void> {
    const currentYear = dayjs().year();
    const existing = holidayDao.getHolidaysByYear(String(currentYear));
    if (existing.length === 0) {
      this.seedFallbackHolidays(currentYear);
    }

    const lastSync = getLastHolidaySync();
    const syncedToday = lastSync && dayjs(lastSync).format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD');
    if (!syncedToday) {
      await this.syncHolidays(currentYear);
    }
  },
};
