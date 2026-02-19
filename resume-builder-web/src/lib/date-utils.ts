export function isYearMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '').trim());
}

export function isPresentToken(value: string) {
  return /^present$/i.test(String(value || '').trim());
}

export function toYearMonth(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isPresentToken(raw)) return 'Present';
  if (isYearMonth(raw)) return raw;

  const clean = raw.replace(/[–—]/g, '-').trim();
  const monthYear = clean.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{4})$/i);
  if (monthYear) {
    const month = monthTokenToNumber(monthYear[1]);
    return month ? `${monthYear[2]}-${month}` : '';
  }

  const mmYyyy = clean.match(/^(\d{1,2})[/-](19\d{2}|20\d{2})$/);
  if (mmYyyy) {
    const month = String(Math.max(1, Math.min(12, Number(mmYyyy[1])))).padStart(2, '0');
    return `${mmYyyy[2]}-${month}`;
  }

  const yyyyMm = clean.match(/^(19\d{2}|20\d{2})[/-](\d{1,2})$/);
  if (yyyyMm) {
    const month = String(Math.max(1, Math.min(12, Number(yyyyMm[2])))).padStart(2, '0');
    return `${yyyyMm[1]}-${month}`;
  }

  const yyyyOnly = clean.match(/^(19\d{2}|20\d{2})$/);
  if (yyyyOnly) {
    return `${yyyyOnly[1]}-01`;
  }

  return '';
}

export function compareYearMonth(a: string, b: string) {
  if (!isYearMonth(a) || !isYearMonth(b)) return 0;
  const aIndex = toMonthIndex(a);
  const bIndex = toMonthIndex(b);
  if (aIndex === bIndex) return 0;
  return aIndex > bIndex ? 1 : -1;
}

export function toMonthInputValue(value: string) {
  const normalized = toYearMonth(value);
  if (!normalized || normalized === 'Present') return '';
  return normalized;
}

function monthTokenToNumber(token: string) {
  const key = token.toLowerCase().slice(0, 4);
  const monthMap: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    sept: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  return monthMap[key] || monthMap[key.slice(0, 3)] || '';
}

function toMonthIndex(value: string) {
  const [year, month] = value.split('-').map((part) => Number(part));
  return year * 12 + (month - 1);
}
