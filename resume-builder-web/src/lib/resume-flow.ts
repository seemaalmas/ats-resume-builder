import type { Resume, ResumeImportResult, UploadResumeResponse } from './api';
import {
  getEmptyResumeDraft,
  type CertificationItem,
  type ContactInfo,
  type EducationItem,
  type ExperienceItem,
  type ProjectItem,
  type ResumeDraft,
} from './resume-store';
import { toYearMonth } from './date-utils';
import { splitLanguagesFromSkills } from './languages';

export type SectionType =
  | 'contact'
  | 'summary'
  | 'skills'
  | 'languages'
  | 'experience'
  | 'education'
  | 'projects'
  | 'certifications';

export type SectionState = {
  id: string;
  type: SectionType;
  enabled: boolean;
  required: boolean;
};

export type FeedbackLevel = 'good' | 'warn' | 'error';
export type RoleLevel = 'FRESHER' | 'MID' | 'SENIOR' | '';

export type ExperienceLevelSignals = {
  roleCount: number;
  distinctCompanyCount: number;
  rolesWithDateCount: number;
  roleCompanyPatternCount: number;
  estimatedTotalMonths: number;
};

export type UploadSummary = {
  roleLevel: RoleLevel;
  experienceCount: number;
  companyCount: number;
  experienceSignals?: ExperienceLevelSignals;
  sectionsPopulated: SectionType[];
  reviewTarget: SectionType;
};

export type PendingUploadSession = {
  createdAt: number;
  resume: ResumeDraft;
  importNotes: string;
  fileName?: string;
  roleLevel: RoleLevel;
  uploadSummary: UploadSummary;
};

export type ScratchEditorState = {
  resume: ResumeDraft;
  importNotes: string;
  roleLevel: RoleLevel;
  uploadSummary: UploadSummary | null;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SessionStorageLike = StorageLike;

export const PENDING_UPLOAD_SESSION_KEY = 'resume-builder.pending-upload.v1';
export const REQUIRED_FLOW_SEQUENCE: SectionType[] = ['contact', 'summary', 'experience', 'education', 'skills'];

export function buildEditorRoute(flow: 'upload' | 'review' | 'scratch', template = '') {
  const cleanTemplate = template.trim();
  const templateQuery = cleanTemplate ? `&template=${encodeURIComponent(cleanTemplate)}` : '';
  return `/resume?flow=${flow}${templateQuery}`;
}

export function buildReviewAtsRoute(template = '', resumeId = '') {
  const params = new URLSearchParams();
  const cleanTemplate = template.trim();
  const cleanResumeId = resumeId.trim();
  if (cleanTemplate) params.set('template', cleanTemplate);
  if (cleanResumeId) params.set('id', cleanResumeId);
  const query = params.toString();
  return query ? `/resume/review?${query}` : '/resume/review';
}

export function formatRoleLevel(level: RoleLevel) {
  if (level === 'FRESHER') return 'Fresher / Entry';
  if (level === 'SENIOR') return 'Senior';
  if (level === 'MID') return 'Mid-level';
  return 'Not detected';
}

export function normalizeUploadParsed(result: UploadResumeResponse): ResumeImportResult {
  const parsed = result.parsed;
  if (!parsed || typeof parsed !== 'object') {
    return result;
  }
  return {
    ...result,
    ...parsed,
    unmappedText: parsed.unmappedText || result.unmappedText,
  };
}

export function sanitizeContact(contact: ContactInfo): ContactInfo {
  const fullName = contact.fullName?.trim() || '';
  const email = contact.email?.trim() || undefined;
  const phone = contact.phone?.trim() || undefined;
  const location = contact.location?.trim() || undefined;
  const links = (contact.links || []).map((link) => link.trim()).filter(Boolean);
  return {
    fullName,
    email,
    phone,
    location,
    links: links.length ? links : undefined,
  };
}

export function isMeaningfulExperience(item: ExperienceItem) {
  return Boolean(
    item.company.trim() ||
    item.role.trim() ||
    item.startDate.trim() ||
    item.endDate.trim() ||
    item.highlights.some((h) => h.trim().length > 0),
  );
}

function isMeaningfulEducation(item: EducationItem) {
  return Boolean(
    item.institution.trim() ||
    item.degree.trim() ||
    item.startDate.trim() ||
    item.endDate.trim() ||
    (item.details || []).some((line) => line.trim().length > 0) ||
    typeof item.gpa === 'number' ||
    typeof item.percentage === 'number',
  );
}

function isMeaningfulProjects(item: ProjectItem) {
  return Boolean(
    item.name.trim() ||
    (item.role || '').trim() ||
    (item.startDate || '').trim() ||
    (item.endDate || '').trim() ||
    (item.url || '').trim() ||
    item.highlights.some((line) => line.trim().length > 0),
  );
}

function isMeaningfulCertification(item: CertificationItem) {
  return Boolean(
    item.name.trim() ||
    (item.issuer || '').trim() ||
    (item.date || '').trim() ||
    (item.details || []).some((line) => line.trim().length > 0),
  );
}

export function draftFromImport(parsed: ResumeImportResult): { resume: ResumeDraft; unmappedText: string } {
  const experience = parsed.experience
    .map((item) => ({
      company: item.company.trim(),
      role: item.role.trim(),
      startDate: item.startDate.trim(),
      endDate: item.endDate.trim(),
      highlights: item.highlights.map((line) => line.trim()).filter((line) => hasAlphaNumeric(line)),
    }))
    .filter((item) => isUploadMappableExperience(item) || captureImportBlock(item));

  const strictExperience = experience.filter(isUploadMappableExperience);
  const droppedExperience = experience
    .filter((item) => !isUploadMappableExperience(item))
    .map((item) => captureImportBlock(item));

  const education = parsed.education
    .map((item) => ({
      institution: item.institution.trim(),
      degree: item.degree.trim(),
      startDate: item.startDate.trim(),
      endDate: item.endDate.trim(),
      details: (item.details || []).map((line) => line.trim()).filter(Boolean),
      gpa: typeof item.gpa === 'number' ? item.gpa : null,
      percentage: typeof item.percentage === 'number' ? item.percentage : null,
    }))
    .filter((item) => isStrictEducation(item) || captureImportBlock(item));

  const strictEducation = education.filter(isStrictEducation);
  const droppedEducation = education
    .filter((item) => !isStrictEducation(item))
    .map((item) => captureImportBlock(item));

  const projects = (parsed.projects || [])
    .map((item) => ({
      name: item.name.trim(),
      role: item.role?.trim(),
      startDate: item.startDate?.trim(),
      endDate: item.endDate?.trim(),
      url: item.url?.trim(),
      highlights: item.highlights.map((line) => line.trim()).filter(Boolean),
    }))
    .filter((item) => item.name || item.highlights.length || item.url);

  const certifications = (parsed.certifications || [])
    .map((item) => ({
      name: item.name.trim(),
      issuer: item.issuer?.trim(),
      date: item.date?.trim(),
      details: (item.details || []).map((line) => line.trim()).filter(Boolean),
    }))
    .filter((item) => item.name);

  const importNotes = [
    parsed.unmappedText || '',
    ...droppedExperience,
    ...droppedEducation,
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

  const skillCategories = normalizeSkillCategories({
    skills: parsed.skills || [],
    technicalSkills: parsed.technicalSkills || [],
    softSkills: parsed.softSkills || [],
    languages: parsed.languages || [],
  });

  return {
    resume: {
      title: parsed.title?.trim() || '',
      contact: sanitizeContact(parsed.contact || { fullName: '' }),
      summary: parsed.summary?.trim() || '',
      skills: skillCategories.skills,
      technicalSkills: skillCategories.technicalSkills,
      softSkills: skillCategories.softSkills,
      languages: skillCategories.languages,
      experience: strictExperience,
      education: strictEducation,
      projects,
      certifications,
    },
    unmappedText: importNotes,
  };
}

export function isStrictExperience(item: ExperienceItem) {
  return (
    item.company.length >= 2 &&
    item.role.length >= 2 &&
    item.startDate.length >= 4 &&
    item.endDate.length >= 4 &&
    item.highlights.length >= 1
  );
}

export function isUploadMappableExperience(item: ExperienceItem) {
  const company = item.company.trim();
  const role = item.role.trim();
  if (company.length < 2) return false;
  if (role.length >= 2) return true;
  return looksLikeCompanyName(company);
}

export function isStrictEducation(item: EducationItem) {
  return (
    item.institution.length >= 2 &&
    item.degree.length >= 2 &&
    item.startDate.length >= 4 &&
    item.endDate.length >= 4
  );
}

export function captureImportBlock(item: { [key: string]: string | string[] | number | null | undefined }) {
  const fragments = Object.values(item)
    .flatMap((value) => Array.isArray(value) ? value : [value || ''])
    .map((value) => String(value).trim())
    .filter(Boolean);
  return fragments.length ? `From Upload: ${fragments.join(' | ')}` : '';
}

export function chooseUploadReviewTarget(resume: ResumeDraft): SectionType {
  const skillCategories = normalizeSkillCategories({
    skills: resume.skills || [],
    technicalSkills: resume.technicalSkills || [],
    softSkills: resume.softSkills || [],
    languages: resume.languages || [],
  });
  const hasContactName = resume.contact.fullName.trim().length >= 2;
  const hasContactMethod = Boolean((resume.contact.email || '').trim() || (resume.contact.phone || '').trim());
  if (!hasContactName || !hasContactMethod) return 'contact';
  if (resume.experience.some(isMeaningfulExperience)) return 'experience';
  if (!resume.summary.trim()) return 'summary';
  if (!resume.education.some(isMeaningfulEducation)) return 'education';
  if (!skillCategories.skills.length) return 'skills';
  return 'experience';
}

export function getPopulatedSections(resume: ResumeDraft): SectionType[] {
  const skillCategories = normalizeSkillCategories({
    skills: resume.skills || [],
    technicalSkills: resume.technicalSkills || [],
    softSkills: resume.softSkills || [],
    languages: resume.languages || [],
  });
  const populated: SectionType[] = [];
  if (
    resume.contact.fullName.trim() ||
    (resume.contact.email || '').trim() ||
    (resume.contact.phone || '').trim() ||
    (resume.contact.location || '').trim() ||
    (resume.contact.links || []).some((link) => link.trim())
  ) {
    populated.push('contact');
  }
  if (resume.summary.trim()) populated.push('summary');
  if (skillCategories.skills.length) populated.push('skills');
  if (skillCategories.languages.length) populated.push('languages');
  if (resume.experience.some(isMeaningfulExperience)) populated.push('experience');
  if (resume.education.some(isMeaningfulEducation)) populated.push('education');
  if (resume.projects.some(isMeaningfulProjects)) populated.push('projects');
  if (resume.certifications.some(isMeaningfulCertification)) populated.push('certifications');
  return populated;
}

export function createUploadSummary(resume: ResumeDraft, roleLevel?: RoleLevel): UploadSummary {
  const meaningfulExperience = resume.experience.filter(isMeaningfulExperience);
  const companyCount = new Set(
    meaningfulExperience
      .map((item) => item.company.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean),
  ).size;
  const detection = detectExperienceLevelFromResume(resume);
  return {
    roleLevel: roleLevel || detection.level,
    experienceCount: meaningfulExperience.length,
    companyCount,
    experienceSignals: detection.signals,
    sectionsPopulated: getPopulatedSections(resume),
    reviewTarget: chooseUploadReviewTarget(resume),
  };
}

export function buildPendingUploadSession(uploadResult: UploadResumeResponse): PendingUploadSession {
  const parsed = normalizeUploadParsed(uploadResult);
  const imported = draftFromImport(parsed);
  const summary = createUploadSummary(imported.resume, parsed.roleLevel || '');
  return {
    createdAt: Date.now(),
    resume: imported.resume,
    importNotes: imported.unmappedText || uploadResult.text || '',
    fileName: (uploadResult.fileName || '').trim() || undefined,
    roleLevel: summary.roleLevel,
    uploadSummary: summary,
  };
}

export function createScratchEditorState(): ScratchEditorState {
  return {
    resume: getEmptyResumeDraft(),
    importNotes: '',
    roleLevel: '',
    uploadSummary: null,
  };
}

export function savePendingUploadSession(session: PendingUploadSession, storage?: StorageLike) {
  const target = resolveStorage(storage);
  if (!target) return false;
  target.setItem(PENDING_UPLOAD_SESSION_KEY, JSON.stringify(session));
  return true;
}

export function readPendingUploadSession(storage?: StorageLike): PendingUploadSession | null {
  const target = resolveStorage(storage);
  if (!target) return null;
  const raw = target.getItem(PENDING_UPLOAD_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingUploadSession;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.resume || typeof parsed.resume !== 'object') return null;
    if (!parsed.uploadSummary || typeof parsed.uploadSummary !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingUploadSession(storage?: StorageLike) {
  const target = resolveStorage(storage);
  if (!target) return;
  target.removeItem(PENDING_UPLOAD_SESSION_KEY);
}

export function consumePendingUploadSession(storage?: StorageLike): PendingUploadSession | null {
  const parsed = readPendingUploadSession(storage);
  if (!parsed) return null;
  clearPendingUploadSession(storage);
  return parsed;
}

export function canContinueToReview(session: PendingUploadSession | null | undefined) {
  if (!session) return false;
  if (!session.resume || !session.uploadSummary) return false;
  const hasContent = getPopulatedSections(session.resume).length > 0;
  return hasContent;
}

export function stagePendingUploadInStore(
  session: PendingUploadSession,
  setResume: (updater: ResumeDraft | ((prev: ResumeDraft) => ResumeDraft)) => void,
) {
  setResume(() => session.resume);
}

export function continueToReviewFromStart(input: {
  session: PendingUploadSession | null | undefined;
  template?: string;
  setResume: (updater: ResumeDraft | ((prev: ResumeDraft) => ResumeDraft)) => void;
  setUploadedFileName?: (fileName: string) => void;
  storage?: StorageLike;
}) {
  const session = input.session;
  if (!session || !canContinueToReview(session)) {
    return { enabled: false, cached: false, href: '' };
  }
  stagePendingUploadInStore(session, input.setResume);
  if (input.setUploadedFileName && session.fileName) {
    input.setUploadedFileName(session.fileName);
  }
  const cached = savePendingUploadSession(session, input.storage);
  return {
    enabled: true,
    cached,
    href: buildEditorRoute('review', input.template || ''),
  };
}

export function continueToReviewAtsFromStart(input: {
  session: PendingUploadSession | null | undefined;
  template?: string;
  setResume: (updater: ResumeDraft | ((prev: ResumeDraft) => ResumeDraft)) => void;
  setUploadedFileName?: (fileName: string) => void;
  storage?: StorageLike;
}) {
  const next = continueToReviewFromStart(input);
  if (!next.enabled) {
    return next;
  }
  return {
    ...next,
    href: buildReviewAtsRoute(input.template || ''),
  };
}

export function resolveEditorUploadNavigation(currentFlow: string, template = '') {
  const normalized = String(currentFlow || '').trim().toLowerCase();
  return {
    shouldReplace: normalized === 'scratch',
    href: buildEditorRoute('review', template),
    modeBadge: 'Imported resume',
  };
}

export function buildResumePayload(resume: ResumeDraft, sections: SectionState[]) {
  const enabled = new Set(sections.filter((s) => s.enabled).map((s) => s.type));
  const trimmedContact = sanitizeContact(resume.contact);
  const skillCategories = normalizeSkillCategories({
    skills: resume.skills || [],
    technicalSkills: resume.technicalSkills || [],
    softSkills: resume.softSkills || [],
    languages: resume.languages || [],
  });
  return {
    title: resume.title.trim() || resume.contact.fullName.trim() || 'Resume',
    contact: enabled.has('contact') ? trimmedContact : undefined,
    summary: enabled.has('summary') ? resume.summary.trim() : '',
    skills: enabled.has('skills') ? skillCategories.skills : [],
    technicalSkills: enabled.has('skills') ? skillCategories.technicalSkills : [],
    softSkills: enabled.has('skills') ? skillCategories.softSkills : [],
    languages: enabled.has('languages') || skillCategories.languages.length
      ? skillCategories.languages
      : [],
    experience: enabled.has('experience')
      ? resume.experience.map((item) => ({
        company: item.company.trim(),
        role: item.role.trim(),
        startDate: normalizeDateForPayload(item.startDate),
        endDate: normalizeDateForPayload(item.endDate),
        highlights: item.highlights.map((line) => line.trim()).filter(Boolean),
      }))
      : [],
    education: enabled.has('education')
      ? resume.education.map((item) => ({
        institution: item.institution.trim(),
        degree: item.degree.trim(),
        startDate: normalizeDateForPayload(item.startDate),
        endDate: normalizeDateForPayload(item.endDate),
        details: (item.details || []).map((line) => line.trim()).filter(Boolean),
        gpa: item.gpa ?? null,
        percentage: item.percentage ?? null,
      }))
      : [],
    projects: enabled.has('projects')
      ? resume.projects.map((item) => ({
        name: item.name.trim(),
        role: item.role?.trim(),
        startDate: normalizeOptionalDateForPayload(item.startDate),
        endDate: normalizeOptionalDateForPayload(item.endDate),
        url: normalizeOptionalHttpsUrl(item.url),
        highlights: item.highlights.map((line) => line.trim()).filter(Boolean),
      }))
      : [],
    certifications: enabled.has('certifications')
      ? resume.certifications.map((item) => ({
        name: item.name.trim(),
        issuer: item.issuer?.trim(),
        date: normalizeOptionalDateForPayload(item.date),
        details: (item.details || []).map((line) => line.trim()).filter(Boolean),
      }))
      : [],
  };
}

function normalizeDateForPayload(value?: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = toYearMonth(raw);
  return normalized || raw;
}

function normalizeOptionalDateForPayload(value?: string) {
  const normalized = normalizeDateForPayload(value);
  return normalized || undefined;
}

function normalizeOptionalHttpsUrl(value?: string) {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  if (!/^https:\/\//i.test(raw)) return raw;
  return raw;
}

export function resumeFromApi(resume: Resume): ResumeDraft {
  const skillCategories = normalizeSkillCategories({
    skills: resume.skills || [],
    technicalSkills: resume.technicalSkills || [],
    softSkills: resume.softSkills || [],
    languages: resume.languages || [],
  });
  return {
    title: resume.title?.trim() || '',
    contact: sanitizeContact(resume.contact || { fullName: '' }),
    summary: resume.summary?.trim() || '',
    skills: skillCategories.skills,
    technicalSkills: skillCategories.technicalSkills,
    softSkills: skillCategories.softSkills,
    languages: skillCategories.languages,
    experience: (resume.experience || []).map((item) => ({
      company: item.company.trim(),
      role: item.role.trim(),
      startDate: item.startDate.trim(),
      endDate: item.endDate.trim(),
      highlights: item.highlights.map((line) => line.trim()).filter(Boolean),
    })),
    education: (resume.education || []).map((item) => ({
      institution: item.institution.trim(),
      degree: item.degree.trim(),
      startDate: item.startDate.trim(),
      endDate: item.endDate.trim(),
      details: (item.details || []).map((line) => line.trim()).filter(Boolean),
      gpa: typeof item.gpa === 'number' ? item.gpa : null,
      percentage: typeof item.percentage === 'number' ? item.percentage : null,
    })),
    projects: (resume.projects || []).map((item) => ({
      name: item.name.trim(),
      role: item.role?.trim(),
      startDate: item.startDate?.trim(),
      endDate: item.endDate?.trim(),
      url: item.url?.trim(),
      highlights: item.highlights.map((line) => line.trim()).filter(Boolean),
    })),
    certifications: (resume.certifications || []).map((item) => ({
      name: item.name.trim(),
      issuer: item.issuer?.trim(),
      date: item.date?.trim(),
      details: (item.details || []).map((line) => line.trim()).filter(Boolean),
    })),
  };
}

export function detectExperienceLevelFromResume(
  resume: ResumeDraft,
): { level: RoleLevel; signals: ExperienceLevelSignals } {
  const meaningful = resume.experience.filter(isMeaningfulExperience);
  const signals: ExperienceLevelSignals = {
    roleCount: meaningful.length,
    distinctCompanyCount: new Set(
      meaningful.map((item) => item.company.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean),
    ).size,
    rolesWithDateCount: meaningful.filter((item) => {
      const hasStart = parseDateToken(item.startDate || '', false);
      const hasEnd = parseDateToken(item.endDate || '', true);
      return Boolean(
        hasStart ||
        hasEnd ||
        /present|current|now/i.test(item.endDate || ''),
      );
    }).length,
    roleCompanyPatternCount: meaningful.filter((item) => item.role.trim() && item.company.trim()).length,
    estimatedTotalMonths: estimateExperienceMonths(meaningful),
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

  const text = `${resume.summary} ${resume.skills.join(' ')} ${meaningful.map((item) => `${item.role} ${item.company}`).join(' ')}`.toLowerCase();
  if (/(intern|internship|student|fresher|entry level|entry-level|junior)/.test(text) && signals.estimatedTotalMonths < 24) {
    return { level: 'FRESHER', signals };
  }
  return { level: 'MID', signals };
}

export function getNavigationGateState(
  feedback: Record<SectionType, { level: FeedbackLevel; text: string }>,
  activeStepIndex: number,
) {
  const firstBlockedIndex = REQUIRED_FLOW_SEQUENCE.findIndex((type) => feedback[type].level === 'error');
  const furthestUnlockedIndex = firstBlockedIndex === -1 ? REQUIRED_FLOW_SEQUENCE.length - 1 : firstBlockedIndex;
  const nextActiveIndex = Math.max(0, Math.min(activeStepIndex, furthestUnlockedIndex));
  const activeStepType = REQUIRED_FLOW_SEQUENCE[nextActiveIndex];
  const canProceedCurrent = feedback[activeStepType].level !== 'error';
  return {
    activeStepIndex: nextActiveIndex,
    activeStepType,
    canProceedCurrent,
    firstBlockedIndex,
    furthestUnlockedIndex,
    isStepLocked: (type: SectionType) => {
      const idx = REQUIRED_FLOW_SEQUENCE.indexOf(type);
      return idx >= 0 && idx > furthestUnlockedIndex;
    },
  };
}

export function canContinueToAts(feedback: Record<SectionType, { level: FeedbackLevel; text: string }>) {
  return REQUIRED_FLOW_SEQUENCE.every((section) => feedback[section].level !== 'error');
}

function hasAlphaNumeric(value: string) {
  return /[a-z0-9]/i.test(value);
}

function looksLikeCompanyName(value: string) {
  if (!value) return false;
  if (/(inc|llc|ltd|corp|company|technologies|systems|labs|solutions|group|studio|partners|bank|consulting|digital)\b/i.test(value)) {
    return true;
  }
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 7) return false;
  const titleCaseTokens = tokens.filter((token) => /^[A-Z][A-Za-z0-9&'.-]*$/.test(token)).length;
  return titleCaseTokens >= Math.ceil(tokens.length * 0.6);
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
  const monthYearNumeric = clean.match(/\b(\d{1,2})[-/](19\d{2}|20\d{2})\b/);
  if (monthYearNumeric) {
    return { year: Number(monthYearNumeric[2]), month: Math.max(1, Math.min(12, Number(monthYearNumeric[1]))) };
  }
  const yearMonth = clean.match(/\b(19\d{2}|20\d{2})[-/](\d{1,2})\b/);
  if (yearMonth) {
    return { year: Number(yearMonth[1]), month: Math.max(1, Math.min(12, Number(yearMonth[2]))) };
  }
  const year = clean.match(/\b(19\d{2}|20\d{2})\b/);
  if (year) {
    return { year: Number(year[1]), month: end ? 12 : 1 };
  }
  return null;
}

function estimateExperienceMonths(experience: ExperienceItem[]) {
  let total = 0;
  for (const item of experience) {
    const start = parseDateToken(item.startDate || '', false);
    if (!start) continue;
    const end = parseDateToken(item.endDate || '', true) || start;
    const startIndex = start.year * 12 + (start.month - 1);
    const endIndex = end.year * 12 + (end.month - 1);
    total += Math.max(1, endIndex - startIndex + 1);
  }
  return total;
}

function normalizeSkillCategories(input: {
  skills: string[];
  technicalSkills?: string[];
  softSkills?: string[];
  languages?: string[];
}) {
  return splitLanguagesFromSkills({
    skills: input.skills || [],
    technicalSkills: input.technicalSkills || [],
    softSkills: input.softSkills || [],
    languages: input.languages || [],
  });
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values || []) {
    const clean = String(value || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}
