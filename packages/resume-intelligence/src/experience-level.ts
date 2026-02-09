import type { ExperienceItem, RoleLevel } from 'resume-schemas';

export type ExperienceSignals = {
  roleCount: number;
  distinctCompanyCount: number;
  rolesWithDateCount: number;
  roleCompanyPatternCount: number;
  estimatedTotalMonths: number;
};

export function computeExperienceLevel(input: {
  resumeText: string;
  experience: ExperienceItem[];
}): { level: RoleLevel; signals: ExperienceSignals } {
  const meaningful = input.experience.filter(isMeaningfulExperience);
  const signals: ExperienceSignals = {
    roleCount: meaningful.length,
    distinctCompanyCount: new Set(
      meaningful.map((entry) => normalizeCompany(entry.company)).filter(Boolean),
    ).size,
    rolesWithDateCount: meaningful.filter((entry) => {
      return Boolean(parseDateToken(entry.startDate || '', false) && parseDateToken(entry.endDate || '', true));
    }).length,
    roleCompanyPatternCount: meaningful.filter((entry) => entry.role.trim() && entry.company.trim()).length,
    estimatedTotalMonths: estimateTotalMonths(meaningful),
  };

  if (signals.roleCount === 0) {
    return { level: 'FRESHER', signals };
  }
  if (signals.roleCount >= 2 || signals.distinctCompanyCount >= 2 || signals.estimatedTotalMonths > 36) {
    return { level: 'SENIOR', signals };
  }
  if (signals.roleCount >= 1 && signals.roleCount <= 2 && signals.rolesWithDateCount >= 1) {
    return { level: 'MID', signals };
  }

  const text = input.resumeText.toLowerCase();
  if (/(intern|internship|student|entry level|entry-level|junior|fresher)/.test(text) && signals.estimatedTotalMonths < 24) {
    return { level: 'FRESHER', signals };
  }
  return { level: 'MID', signals };
}

function isMeaningfulExperience(entry: ExperienceItem) {
  return Boolean(
    entry.company.trim() ||
    entry.role.trim() ||
    (entry.startDate || '').trim() ||
    (entry.endDate || '').trim() ||
    entry.highlights.some((line) => line.trim().length > 0),
  );
}

function normalizeCompany(company: string) {
  return company.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function estimateTotalMonths(experience: ExperienceItem[]) {
  let total = 0;
  for (const entry of experience) {
    const start = parseDateToken(entry.startDate || '', false);
    if (!start) continue;
    const end = parseDateToken(entry.endDate || '', true) || start;
    const startIndex = start.year * 12 + (start.month - 1);
    const endIndex = end.year * 12 + (end.month - 1);
    total += Math.max(1, endIndex - startIndex + 1);
  }
  return total;
}

function parseDateToken(token: string, end: boolean) {
  if (!token) return null;
  const clean = token.trim().toLowerCase();
  if (!clean) return null;
  if (/present|current|now/.test(clean)) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  const monthMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };
  const monthYear = clean.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{4})/);
  if (monthYear) {
    const month = monthMap[monthYear[1].slice(0, 4)] || monthMap[monthYear[1].slice(0, 3)] || 1;
    return { year: Number(monthYear[2]), month };
  }
  const yearMonth = clean.match(/(\d{4})[-/](\d{1,2})/);
  if (yearMonth) {
    return { year: Number(yearMonth[1]), month: Math.max(1, Math.min(12, Number(yearMonth[2]))) };
  }
  const year = clean.match(/\b(19\d{2}|20\d{2})\b/);
  if (year) {
    return { year: Number(year[1]), month: end ? 12 : 1 };
  }
  return null;
}
