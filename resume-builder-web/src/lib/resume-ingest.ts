import { api, type ResumeImportResult, type UploadResumeResponse } from './api';
import {
  buildPendingUploadSession,
  createUploadSummary,
  detectExperienceLevelFromResume,
  type ExperienceLevelSignals,
  type PendingUploadSession,
  type RoleLevel,
  type UploadSummary,
} from './resume-flow';
import type {
  CertificationItem,
  ContactInfo,
  EducationItem,
  ExperienceItem,
  ProjectItem,
  ResumeDraft,
} from './resume-store';
import { splitLanguagesFromSkills } from './languages';

export type ResumeIngestResult = {
  resume: ResumeDraft;
  importNotes: string;
  roleLevel: RoleLevel;
  uploadSummary: UploadSummary;
  signals: ExperienceLevelSignals;
  pendingSession: PendingUploadSession;
  raw: UploadResumeResponse;
};

export async function ingestResumeFile(
  file: File,
  options?: {
    baseResume?: ResumeDraft;
    baseImportNotes?: string;
  },
): Promise<ResumeIngestResult> {
  const uploadResult = await api.uploadResume(file);
  return applyParsedResume(uploadResult, options);
}

export function applyParsedResume(
  uploadResult: UploadResumeResponse,
  options?: {
    baseResume?: ResumeDraft;
    baseImportNotes?: string;
  },
): ResumeIngestResult {
  const parsedSession = buildPendingUploadSession(uploadResult);
  const nextResume = options?.baseResume
    ? mergeImportedResume(options.baseResume, parsedSession.resume)
    : parsedSession.resume;
  const nextImportNotes = mergeImportNotes(options?.baseImportNotes || '', parsedSession.importNotes || '');
  const detection = detectExperienceLevelFromResume(nextResume);
  const uploadSummary = createUploadSummary(nextResume, detection.level);

  const pendingSession: PendingUploadSession = {
    createdAt: Date.now(),
    resume: nextResume,
    importNotes: nextImportNotes,
    fileName: (uploadResult.fileName || '').trim() || undefined,
    roleLevel: uploadSummary.roleLevel,
    uploadSummary,
  };

  return {
    resume: nextResume,
    importNotes: nextImportNotes,
    roleLevel: uploadSummary.roleLevel,
    uploadSummary,
    signals: detection.signals,
    pendingSession,
    raw: uploadResult,
  };
}

function mergeImportNotes(existing: string, incoming: string) {
  const merged = [...existing.split(/\n+/), ...incoming.split(/\n+/)]
    .map((line) => line.trim())
    .filter(Boolean);
  if (!merged.length) return '';
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of merged) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(line);
  }
  return output.join('\n');
}

function mergeImportedResume(current: ResumeDraft, parsed: ResumeImportResult): ResumeDraft {
  const categories = normalizeSkillCategories({
    skills: parsed.skills || [],
    technicalSkills: parsed.technicalSkills || [],
    softSkills: parsed.softSkills || [],
    languages: parsed.languages || [],
  });
  const mergedCategories = normalizeSkillCategories({
    skills: current.skills || [],
    technicalSkills: mergeList(current.technicalSkills || [], categories.technicalSkills),
    softSkills: mergeList(current.softSkills || [], categories.softSkills),
    languages: mergeList(current.languages || [], categories.languages || []),
  });
  return {
    title: current.title.trim() ? current.title : parsed.title || current.title,
    contact: mergeContact(current.contact, parsed.contact),
    summary: current.summary.trim() ? current.summary : parsed.summary || current.summary,
    skills: mergedCategories.skills,
    technicalSkills: mergedCategories.technicalSkills,
    softSkills: mergedCategories.softSkills,
    languages: mergedCategories.languages,
    experience: mergeExperience(current.experience, parsed.experience || []),
    education: mergeEducation(current.education, parsed.education || []),
    projects: mergeProjects(current.projects, parsed.projects || []),
    certifications: mergeCertifications(current.certifications, parsed.certifications || []),
  };
}

function mergeContact(current: ContactInfo, incoming?: ContactInfo): ContactInfo {
  if (!incoming) return current;
  return {
    fullName: current.fullName || incoming.fullName || '',
    email: current.email || incoming.email,
    phone: current.phone || incoming.phone,
    location: current.location || incoming.location,
    links: mergeList(current.links || [], incoming.links || []),
  };
}

function mergeList(current: string[], incoming: string[]) {
  const merged = [...current, ...incoming].map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(merged));
}

function isMeaningfulExperience(item: ExperienceItem) {
  return Boolean(
    item.company.trim() ||
    item.role.trim() ||
    item.startDate.trim() ||
    item.endDate.trim() ||
    item.highlights.some((line) => line.trim().length > 0),
  );
}

function mergeExperience(current: ExperienceItem[], incoming: ExperienceItem[]) {
  const currentMeaningful = current.filter(isMeaningfulExperience);
  const incomingMeaningful = incoming.filter(isMeaningfulExperience);
  if (!incomingMeaningful.length) return current;
  if (!currentMeaningful.length) return sortExperience(incomingMeaningful);

  const map = new Map<string, ExperienceItem>();
  for (const item of currentMeaningful) {
    map.set(experienceKey(item), { ...item, highlights: item.highlights.filter(Boolean) });
  }

  for (const item of incomingMeaningful) {
    const key = experienceKey(item);
    if (!map.has(key)) {
      map.set(key, { ...item, highlights: item.highlights.filter(Boolean) });
      continue;
    }
    const merged = map.get(key)!;
    merged.highlights = mergeList(merged.highlights, item.highlights || []);
    merged.startDate = merged.startDate || item.startDate;
    merged.endDate = merged.endDate || item.endDate;
    merged.role = merged.role || item.role;
    merged.company = merged.company || item.company;
    map.set(key, merged);
  }

  return sortExperience(Array.from(map.values()));
}

function experienceKey(item: ExperienceItem) {
  const company = item.company.toLowerCase().replace(/[^a-z0-9]/g, '');
  const role = item.role.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${company}|${role}|${item.startDate}|${item.endDate}`;
}

function mergeEducation(current: EducationItem[], incoming: EducationItem[]) {
  const currentMeaningful = current.filter((item) => item.institution.trim() || item.degree.trim() || (item.details || []).some(Boolean) || typeof item.gpa === 'number' || typeof item.percentage === 'number');
  const incomingMeaningful = incoming.filter((item) => item.institution.trim() || item.degree.trim() || (item.details || []).some(Boolean) || typeof item.gpa === 'number' || typeof item.percentage === 'number');
  if (!incomingMeaningful.length) return current;
  if (!currentMeaningful.length) return incomingMeaningful;

  const map = new Map<string, EducationItem>();
  for (const item of currentMeaningful) {
    map.set(`${item.institution}|${item.degree}`, item);
  }
  for (const item of incomingMeaningful) {
    const key = `${item.institution}|${item.degree}`;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
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

function mergeProjects(current: ProjectItem[], incoming: ProjectItem[]) {
  const currentMeaningful = current.filter((item) => item.name.trim() || (item.url || '').trim() || item.highlights.some(Boolean));
  const incomingMeaningful = incoming.filter((item) => item.name.trim() || (item.url || '').trim() || item.highlights.some(Boolean));
  if (!incomingMeaningful.length) return current;
  if (!currentMeaningful.length) return incomingMeaningful;

  const map = new Map<string, ProjectItem>();
  for (const item of currentMeaningful) map.set(item.name.toLowerCase(), item);
  for (const item of incomingMeaningful) {
    const key = item.name.toLowerCase();
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function mergeCertifications(current: CertificationItem[], incoming: CertificationItem[]) {
  const currentMeaningful = current.filter((item) => item.name.trim());
  const incomingMeaningful = incoming.filter((item) => item.name.trim());
  if (!incomingMeaningful.length) return current;
  if (!currentMeaningful.length) return incomingMeaningful;

  const map = new Map<string, CertificationItem>();
  for (const item of currentMeaningful) map.set(item.name.toLowerCase(), item);
  for (const item of incomingMeaningful) {
    const key = item.name.toLowerCase();
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function sortExperience(items: ExperienceItem[]) {
  const sorted = [...items];
  sorted.sort((a, b) => {
    const endA = dateSortValue(a.endDate || a.startDate, true);
    const endB = dateSortValue(b.endDate || b.startDate, true);
    if (endB !== endA) return endB - endA;
    return dateSortValue(b.startDate, false) - dateSortValue(a.startDate, false);
  });
  return sorted;
}

function dateSortValue(token: string, end: boolean) {
  const parsed = parseDateToken(token, end);
  if (!parsed) return 0;
  return parsed.year * 100 + parsed.month;
}

function parseDateToken(token: string, end: boolean) {
  if (!token) return null;
  if (/present|current|now/i.test(token)) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  const clean = token.toLowerCase().trim();
  const monthMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };
  const monthYear = clean.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{4})/i);
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
