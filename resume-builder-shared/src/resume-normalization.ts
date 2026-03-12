import type { ResumeImportResult } from './types/index.js';

export type AtsSectionKey =
  | 'header'
  | 'summary'
  | 'skills'
  | 'experience'
  | 'projects'
  | 'education'
  | 'certifications'
  | 'languages';

export const ATS_SECTION_ORDER: AtsSectionKey[] = [
  'header',
  'summary',
  'skills',
  'experience',
  'projects',
  'education',
  'certifications',
  'languages',
];

const SECTION_TITLE_MAP: Record<Exclude<AtsSectionKey, 'header'>, string> = {
  summary: 'Summary',
  skills: 'Skills',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  languages: 'Languages',
};

const PRESENT_RE = /^(present|current|now)$/i;
const LEGACY_BULLET_PREFIX_RE = /^(impact|achievement|result|highlights?|accomplishment)s?:\s*/i;
const BULLET_SYMBOL_RE = /^\s*(?:[-*•·]+|\d{1,3}[.)]|[a-z][.)])\s*/i;
const PLACEHOLDER_RE = /^[-_/.,\s|]+$/;

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_MAP: Record<string, string> = {
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

type ResumeLike = {
  title?: string;
  contact?: {
    fullName?: string;
    email?: string;
    phone?: string;
    location?: string;
    links?: string[];
  };
  summary?: string;
  skills?: string[];
  technicalSkills?: string[];
  softSkills?: string[];
  languages?: string[];
  experience?: Array<{
    company?: string;
    role?: string;
    startDate?: string;
    endDate?: string;
    highlights?: string[];
  }>;
  education?: Array<{
    institution?: string;
    degree?: string;
    startDate?: string;
    endDate?: string;
    details?: string[];
    gpa?: number | null;
    percentage?: number | null;
  }>;
  projects?: Array<{
    name?: string;
    role?: string;
    startDate?: string;
    endDate?: string;
    url?: string;
    highlights?: string[];
  }>;
  certifications?: Array<{
    name?: string;
    issuer?: string;
    date?: string;
    details?: string[];
  }>;
};

export function sanitizeBulletText(value: string) {
  let output = String(value || '').replace(/\s+/g, ' ').trim();
  if (!output || PLACEHOLDER_RE.test(output)) return '';

  while (BULLET_SYMBOL_RE.test(output)) {
    output = output.replace(BULLET_SYMBOL_RE, '').trim();
  }
  while (LEGACY_BULLET_PREFIX_RE.test(output)) {
    output = output.replace(LEGACY_BULLET_PREFIX_RE, '').trim();
  }

  output = output
    .replace(/^\s*[-:;|]+\s*/, '')
    .replace(/\s*[-:;|]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return output;
}

export function sanitizeBullets<T extends ResumeLike>(resume: T): T {
  const next: ResumeLike = { ...resume };

  next.experience = (Array.isArray(resume.experience) ? resume.experience : []).map((item) => ({
    ...item,
    highlights: sanitizeLineList(item?.highlights || []),
  }));

  next.projects = (Array.isArray(resume.projects) ? resume.projects : []).map((item) => ({
    ...item,
    highlights: sanitizeLineList(item?.highlights || []),
  }));

  next.education = (Array.isArray(resume.education) ? resume.education : []).map((item) => ({
    ...item,
    details: sanitizeLineList(item?.details || []),
  }));

  next.certifications = (Array.isArray(resume.certifications) ? resume.certifications : []).map((item) => ({
    ...item,
    details: sanitizeLineList(item?.details || []),
  }));

  return next as T;
}

export function normalizeDateToken(value: string, options?: { allowPresent?: boolean }) {
  const allowPresent = options?.allowPresent ?? true;
  const raw = String(value || '').replace(/[–—]/g, '-').trim();
  if (!raw || PLACEHOLDER_RE.test(raw)) return '';
  if (allowPresent && PRESENT_RE.test(raw)) return 'Present';

  const monthYear = raw.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(19\d{2}|20\d{2})$/i);
  if (monthYear) {
    const month = MONTH_MAP[monthYear[1].toLowerCase().slice(0, 4)] || MONTH_MAP[monthYear[1].toLowerCase().slice(0, 3)];
    if (!month) return '';
    return `${monthYear[2]}-${month}`;
  }

  const mmYyyy = raw.match(/^(\d{1,2})[/-](19\d{2}|20\d{2})$/);
  if (mmYyyy) {
    const month = Number(mmYyyy[1]);
    if (Number.isNaN(month) || month < 1 || month > 12) return '';
    return `${mmYyyy[2]}-${String(month).padStart(2, '0')}`;
  }

  const yyyyMm = raw.match(/^(19\d{2}|20\d{2})[/-](\d{1,2})$/);
  if (yyyyMm) {
    const month = Number(yyyyMm[2]);
    if (Number.isNaN(month) || month < 1 || month > 12) return '';
    return `${yyyyMm[1]}-${String(month).padStart(2, '0')}`;
  }

  const yyyyOnly = raw.match(/^(19\d{2}|20\d{2})$/);
  if (yyyyOnly) {
    return `${yyyyOnly[1]}-01`;
  }

  return '';
}

export function formatDateForDisplay(value: string) {
  const normalized = normalizeDateToken(value, { allowPresent: true });
  if (!normalized) return '';
  if (normalized === 'Present') return 'Present';
  const match = normalized.match(/^(19\d{2}|20\d{2})-(0[1-9]|1[0-2])$/);
  if (!match) return '';
  const monthIndex = Number(match[2]) - 1;
  return `${MONTH_LABELS[monthIndex]} ${match[1]}`;
}

export function formatDateRange(startDate: string, endDate: string) {
  const start = formatDateForDisplay(startDate || '');
  const end = formatDateForDisplay(endDate || '');
  if (start && end) return `${start} - ${end}`;
  if (start) return start;
  if (end) return end;
  return '';
}

export function normalizeDates<T extends ResumeLike>(resume: T): T {
  const next: ResumeLike = { ...resume };

  next.experience = (Array.isArray(resume.experience) ? resume.experience : []).map((item) => ({
    ...item,
    startDate: normalizeDateToken(String(item?.startDate || ''), { allowPresent: false }),
    endDate: normalizeDateToken(String(item?.endDate || ''), { allowPresent: true }),
  }));

  next.education = (Array.isArray(resume.education) ? resume.education : []).map((item) => ({
    ...item,
    startDate: normalizeDateToken(String(item?.startDate || ''), { allowPresent: false }),
    endDate: normalizeDateToken(String(item?.endDate || ''), { allowPresent: false }),
  }));

  next.projects = (Array.isArray(resume.projects) ? resume.projects : []).map((item) => ({
    ...item,
    startDate: normalizeDateToken(String(item?.startDate || ''), { allowPresent: false }) || undefined,
    endDate: normalizeDateToken(String(item?.endDate || ''), { allowPresent: false }) || undefined,
  }));

  next.certifications = (Array.isArray(resume.certifications) ? resume.certifications : []).map((item) => ({
    ...item,
    date: normalizeDateToken(String(item?.date || ''), { allowPresent: false }) || undefined,
  }));

  return next as T;
}

export function normalizeExperienceOrder<T extends ResumeLike>(resume: T): T {
  const next: ResumeLike = { ...resume };
  const sorted = [...(Array.isArray(resume.experience) ? resume.experience : [])];

  sorted.sort((a, b) => {
    const endA = dateSortValue(String(a?.endDate || a?.startDate || ''), true);
    const endB = dateSortValue(String(b?.endDate || b?.startDate || ''), true);
    if (endB !== endA) return endB - endA;
    const startA = dateSortValue(String(a?.startDate || ''), false);
    const startB = dateSortValue(String(b?.startDate || ''), false);
    return startB - startA;
  });

  next.experience = sorted;
  return next as T;
}

export function normalizeSections<T extends ResumeLike>(resume: T): T {
  return {
    ...resume,
    summary: cleanText(String(resume.summary || '')),
    skills: normalizeStringList(resume.skills || []),
    technicalSkills: normalizeStringList(resume.technicalSkills || []),
    softSkills: normalizeStringList(resume.softSkills || []),
    languages: normalizeStringList(resume.languages || []),
    experience: Array.isArray(resume.experience) ? resume.experience : [],
    projects: Array.isArray(resume.projects) ? resume.projects : [],
    education: Array.isArray(resume.education) ? resume.education : [],
    certifications: Array.isArray(resume.certifications) ? resume.certifications : [],
  } as T;
}

export function normalizeResumeForAts<T extends ResumeLike>(resume: T): T {
  return normalizeSections(
    normalizeExperienceOrder(
      normalizeDates(
        sanitizeBullets(resume),
      ),
    ),
  );
}

export function getAtsSectionOrder(resume: ResumeLike): AtsSectionKey[] {
  const normalized = normalizeSections(resume);
  const hasSummary = Boolean(String(normalized.summary || '').trim());
  const hasSkills = (normalized.skills || []).length > 0;
  const hasExperience = (normalized.experience || []).length > 0;
  const hasProjects = (normalized.projects || []).length > 0;
  const hasEducation = (normalized.education || []).length > 0;
  const hasCertifications = (normalized.certifications || []).length > 0;
  const hasLanguages = (normalized.languages || []).length > 0;

  return ATS_SECTION_ORDER.filter((section) => {
    if (section === 'header') return true;
    if (section === 'summary') return hasSummary;
    if (section === 'skills') return hasSkills;
    if (section === 'experience') return hasExperience;
    if (section === 'projects') return hasProjects;
    if (section === 'education') return hasEducation;
    if (section === 'certifications') return hasCertifications;
    if (section === 'languages') return hasLanguages;
    return false;
  });
}

export function getAtsSectionTitle(section: Exclude<AtsSectionKey, 'header'>) {
  return SECTION_TITLE_MAP[section];
}

export function normalizeResumeImportResult(resume: ResumeImportResult): ResumeImportResult {
  return normalizeResumeForAts(resume);
}

function sanitizeLineList(lines: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines || []) {
    const cleaned = sanitizeBulletText(line);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

function cleanText(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeStringList(items: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items || []) {
    const cleaned = cleanText(String(item || ''));
    if (!cleaned || PLACEHOLDER_RE.test(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

function dateSortValue(token: string, end: boolean) {
  if (!token) return 0;
  if (PRESENT_RE.test(token)) return 9_999_12;
  const normalized = normalizeDateToken(token, { allowPresent: true });
  if (!normalized) return 0;
  if (normalized === 'Present') return 9_999_12;
  const match = normalized.match(/^(19\d{2}|20\d{2})-(0[1-9]|1[0-2])$/);
  if (!match) return 0;
  return Number(match[1]) * 100 + Number(match[2]) + (end ? 0 : 0);
}
