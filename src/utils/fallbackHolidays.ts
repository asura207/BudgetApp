import { Holiday } from '../types/budget';

export const fallbackHolidays: Holiday[] = [
  { locdate: '2026-01-01', dateName: '신정', isHoliday: true, isCustom: false },
  { locdate: '2026-02-16', dateName: '설날 연휴', isHoliday: true, isCustom: false },
  { locdate: '2026-02-17', dateName: '설날', isHoliday: true, isCustom: false },
  { locdate: '2026-02-18', dateName: '설날 연휴', isHoliday: true, isCustom: false },
  { locdate: '2026-03-01', dateName: '삼일절', isHoliday: true, isCustom: false },
  { locdate: '2026-03-02', dateName: '대체공휴일(삼일절)', isHoliday: true, isCustom: false },
  { locdate: '2026-05-05', dateName: '어린이날', isHoliday: true, isCustom: false },
  { locdate: '2026-05-24', dateName: '부처님오신날', isHoliday: true, isCustom: false },
  { locdate: '2026-06-06', dateName: '현충일', isHoliday: true, isCustom: false },
  { locdate: '2026-08-15', dateName: '광복절', isHoliday: true, isCustom: false },
  { locdate: '2026-09-24', dateName: '추석 연휴', isHoliday: true, isCustom: false },
  { locdate: '2026-09-25', dateName: '추석', isHoliday: true, isCustom: false },
  { locdate: '2026-09-26', dateName: '추석 연휴', isHoliday: true, isCustom: false },
  { locdate: '2026-10-03', dateName: '개천절', isHoliday: true, isCustom: false },
  { locdate: '2026-10-09', dateName: '한글날', isHoliday: true, isCustom: false },
  { locdate: '2026-12-25', dateName: '성탄절', isHoliday: true, isCustom: false },
];

export const getFallbackHolidaysForYear = (year: number): Holiday[] => {
  if (year === 2026) {
    return fallbackHolidays;
  }
  const fixedHolidays = [
    { mmdd: '01-01', dateName: '신정' },
    { mmdd: '03-01', dateName: '삼일절' },
    { mmdd: '05-05', dateName: '어린이날' },
    { mmdd: '06-06', dateName: '현충일' },
    { mmdd: '08-15', dateName: '광복절' },
    { mmdd: '10-03', dateName: '개천절' },
    { mmdd: '10-09', dateName: '한글날' },
    { mmdd: '12-25', dateName: '성탄절' },
  ];
  return fixedHolidays.map((item) => ({
    locdate: `${year}-${item.mmdd}`,
    dateName: item.dateName,
    isHoliday: true,
    isCustom: false,
  }));
};
