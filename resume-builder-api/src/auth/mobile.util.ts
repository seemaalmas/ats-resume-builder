export function normalizeMobile(input?: string) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/[\s()-]/g, '');
  const plusE164 = compact.match(/^\+(\d{8,15})$/);
  if (plusE164) return `+${plusE164[1]}`;
  const digits = compact.replace(/\D/g, '');
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  return '';
}
