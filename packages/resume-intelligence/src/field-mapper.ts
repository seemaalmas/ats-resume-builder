import type {
  CertificationItem,
  Contact,
  EducationItem,
  ExperienceItem,
  ProjectItem,
  ParsedResume,
} from 'resume-schemas';
import { ParsedResumeSchema } from 'resume-schemas';
import type { ParsedResumeText } from './resume-parser.js';
import { computeExperienceLevel } from './experience-level.js';

export type MappedResumeResult = ParsedResume & {
  signals: {
    roleCount: number;
    distinctCompanyCount: number;
    rolesWithDateCount: number;
    roleCompanyPatternCount: number;
    estimatedTotalMonths: number;
  };
};

export function mapParsedResume(parsed: ParsedResumeText): MappedResumeResult {
  const summary = mapSummary(parsed.sections);
  const skills = mapSkills(parsed.sections);
  const experience = sortExperienceChronological(
    mergeExperienceByCompany(mapExperience(parsed.sections)),
  );
  const education = mapEducation(parsed.sections);
  const projects = mapProjects(parsed.sections);
  const certifications = mapCertifications(parsed.sections);
  const contact = mapContact(parsed.lines);
  const title = guessTitle(parsed.lines);
  const unmappedText = getUnmappedText(parsed.sections);
  const resumeText = [summary, skills.join(' '), experience.map((item) => `${item.role} ${item.company}`).join(' ')].join(' ');
  const levelResult = computeExperienceLevel({ resumeText, experience });

  const validated = ParsedResumeSchema.parse({
    title,
    contact,
    summary,
    skills,
    experience,
    education,
    projects,
    certifications,
    unmappedText: unmappedText || undefined,
    roleLevel: levelResult.level,
  });

  return {
    ...validated,
    signals: levelResult.signals,
  };
}

function mapSummary(sections: Record<string, string[]>) {
  const lines = [
    ...(sections.summary || []),
    ...(sections.profile || []),
    ...(sections.objective || []),
  ];
  const fallback = lines.length ? lines : (sections.unmapped || []).slice(0, 2);
  return fallback.join(' ').slice(0, 400).trim() || 'Professional summary';
}

function mapSkills(sections: Record<string, string[]>) {
  const lines = [
    ...(sections.skills || []),
    ...(sections.technical || []),
    ...(sections.core || []),
    ...(sections.technologies || []),
  ];
  const tokens = lines
    .flatMap((line) => line.replace(/^skills?:?/i, '').split(/,|;|\||\/|·|•|â€¢|Â·/))
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && token.length < 40);
  return Array.from(new Set(tokens)).slice(0, 20);
}

function mapExperience(sections: Record<string, string[]>) {
  const lines = [
    ...(sections.experience || []),
    ...(sections.employment || []),
    ...(sections.work || []),
    ...(sections.career || []),
  ];
  const source = lines.length ? lines : collectLikelyExperienceLines(sections.unmapped || []);
  const blocks: ExperienceItem[] = [];
  let current: ExperienceItem | null = null;

  for (const line of source) {
    if (looksLikeExperienceHeader(line)) {
      if (current && isMeaningfulExperience(current)) blocks.push(current);
      current = buildExperienceHeader(line);
      continue;
    }
    if (!current) {
      current = { company: '', role: '', startDate: '', endDate: '', highlights: [] };
    }
    if (isDateLine(line) && (!current.startDate && !current.endDate)) {
      const dates = extractDates(line);
      current.startDate = dates.start || current.startDate;
      current.endDate = dates.end || current.endDate;
      continue;
    }
    if (line.startsWith('-')) {
      current.highlights.push(line.replace(/^[-*]\s*/, ''));
    } else if (line.length > 10) {
      current.highlights.push(line);
    }
  }

  if (current && isMeaningfulExperience(current)) blocks.push(current);
  return blocks;
}

function mapEducation(sections: Record<string, string[]>) {
  const lines = [
    ...(sections.education || []),
    ...(sections.academics || []),
  ];
  const blocks: EducationItem[] = [];
  let current: EducationItem | null = null;
  for (const line of lines) {
    if (/(university|college|school|institute|bachelor|master|phd|b\.s|m\.s)/i.test(line)) {
      if (current && (current.institution || current.degree)) blocks.push(current);
      const dates = extractDates(line);
      current = { institution: line, degree: line, startDate: dates.start, endDate: dates.end, details: [] };
      continue;
    }
    if (!current) {
      current = { institution: '', degree: '', startDate: '', endDate: '', details: [] };
    }
    if (line.startsWith('-')) current.details.push(line.replace(/^[-*]\s*/, ''));
  }
  if (current && (current.institution || current.degree)) blocks.push(current);
  return blocks;
}

function mapProjects(sections: Record<string, string[]>) {
  const lines = [
    ...(sections.projects || []),
    ...(sections.research || []),
  ];
  const projects: ProjectItem[] = [];
  let current: ProjectItem | null = null;
  for (const line of lines) {
    if (looksLikeProjectTitle(line) || isDateLine(line)) {
      if (current && current.highlights.length) projects.push(current);
      const dates = extractDates(line);
      current = { name: stripDates(line), role: '', startDate: dates.start, endDate: dates.end, highlights: [] };
      continue;
    }
    if (!current) current = { name: 'Project', role: '', startDate: '', endDate: '', highlights: [] };
    if (line.startsWith('-')) current.highlights.push(line.replace(/^[-*]\s*/, ''));
    else if (line.length > 10) current.highlights.push(line);
  }
  if (current && current.highlights.length) projects.push(current);
  return projects;
}

function mapCertifications(sections: Record<string, string[]>) {
  const lines = [
    ...(sections.certifications || []),
    ...(sections.licenses || []),
  ];
  const items: CertificationItem[] = [];
  for (const line of lines) {
    const dateMatch = line.match(/\b(20\d{2}|19\d{2})\b/);
    const cleaned = line.replace(/[()]/g, '').replace(/\b(20\d{2}|19\d{2})\b/g, '').trim();
    if (!cleaned) continue;
    items.push({ name: cleaned, date: dateMatch ? dateMatch[1] : undefined, details: [] });
  }
  return items;
}

function mapContact(lines: string[]): Contact | undefined {
  const top = lines.slice(0, 6);
  const fullName = top.find((line) => line.length < 60 && !/@/.test(line) && !/\d{4}/.test(line)) || '';
  const emailMatch = lines.join(' ').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = lines.join(' ').match(/\+?\d[\d\s().-]{7,}/);
  const links = lines.filter((line) => /linkedin\.com|github\.com|portfolio|website/i.test(line)).slice(0, 3);
  const location = lines.find((line) => /\b(city|state|remote|usa|united states|india|canada|uk)\b/i.test(line));
  if (!fullName && !emailMatch && !phoneMatch) return undefined;
  return {
    fullName: fullName || 'Your Name',
    email: emailMatch ? emailMatch[0] : undefined,
    phone: phoneMatch ? phoneMatch[0] : undefined,
    location,
    links: links.length ? links : undefined,
  };
}

function guessTitle(lines: string[]) {
  const candidate = lines.find((line) => line.length < 60 && !/\d{4}/.test(line) && !/@/.test(line));
  return candidate || 'Resume';
}

function getUnmappedText(sections: Record<string, string[]>) {
  const mappedKeys = new Set([
    'summary', 'profile', 'objective',
    'skills', 'core', 'technical', 'technologies',
    'experience', 'employment', 'work', 'career',
    'education', 'academics',
    'projects', 'research',
    'certifications', 'licenses',
  ]);
  return Object.entries(sections)
    .filter(([key]) => !mappedKeys.has(key))
    .flatMap(([, lines]) => lines)
    .join('\n')
    .trim();
}

function collectLikelyExperienceLines(lines: string[]) {
  const output: string[] = [];
  for (const line of lines) {
    if (looksLikeExperienceHeader(line) || line.startsWith('-') || isDateLine(line)) {
      output.push(line);
      continue;
    }
    if (output.length && line.length > 8) output.push(line);
  }
  return output;
}

function looksLikeExperienceHeader(line: string) {
  if (!line || line.startsWith('-')) return false;
  const hasDate = isDateLine(line);
  const hasRole = /\b(engineer|developer|manager|designer|analyst|intern|lead|architect|specialist|consultant|director|head|officer)\b/i.test(line);
  const hasCompany = /(inc|llc|ltd|corp|company|technologies|systems|labs|solutions|group|studio|partners)\b/i.test(line);
  const hasDelimiter = /@|\sat\s|\s\|\s|\s-\s|\s—\s|\s–\s|â€”|â€“/i.test(line);
  return (hasDate && (hasRole || hasCompany || hasDelimiter)) || (hasRole && (hasCompany || hasDelimiter));
}

function buildExperienceHeader(line: string): ExperienceItem {
  const dates = extractDates(line);
  const stripped = stripDates(line);
  const split = splitRoleCompany(stripped);
  return {
    company: split.company.trim(),
    role: split.role.trim(),
    startDate: dates.start,
    endDate: dates.end,
    highlights: [],
  };
}

function splitRoleCompany(line: string) {
  const normalized = line.replace(/\s{2,}/g, ' ').trim();
  if (!normalized) return { role: '', company: '' };
  if (normalized.includes('@')) {
    const parts = normalized.split('@');
    if (parts.length === 2) return { role: parts[0], company: parts[1] };
  }
  if (/\sat\s/i.test(normalized)) {
    const parts = normalized.split(/\sat\s/i);
    if (parts.length === 2) return { role: parts[0], company: parts[1] };
  }
  for (const delimiter of [' — ', ' – ', ' - ', ' | ', ' â€” ']) {
    if (normalized.includes(delimiter)) {
      const parts = normalized.split(delimiter);
      if (parts.length >= 2) return { role: parts[0], company: parts.slice(1).join(delimiter) };
    }
  }
  return { role: normalized, company: '' };
}

function mergeExperienceByCompany(experience: ExperienceItem[]) {
  const map = new Map<string, ExperienceItem>();
  for (const item of experience) {
    if (!isMeaningfulExperience(item)) continue;
    const key = normalizeCompany(item.company) || `${normalizeCompany(item.role)}|${item.startDate}|${item.endDate}`;
    if (!map.has(key)) {
      map.set(key, {
        ...item,
        highlights: uniqueLines(item.highlights),
      });
      continue;
    }
    const current = map.get(key)!;
    current.role = current.role || item.role;
    current.startDate = pickEarlierDate(current.startDate, item.startDate);
    current.endDate = pickLaterDate(current.endDate, item.endDate);
    current.highlights = uniqueLines([...current.highlights, ...item.highlights]);
    map.set(key, current);
  }
  return Array.from(map.values());
}

function sortExperienceChronological(experience: ExperienceItem[]) {
  const sorted = [...experience];
  sorted.sort((a, b) => {
    const endA = toSortValue(a.endDate || a.startDate, true);
    const endB = toSortValue(b.endDate || b.startDate, true);
    if (endB !== endA) return endB - endA;
    return toSortValue(b.startDate, false) - toSortValue(a.startDate, false);
  });
  return sorted;
}

function isDateLine(line: string) {
  return /(\b(20\d{2}|19\d{2})\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b)/i.test(line)
    && /-|to|–|—|â€“|â€”/i.test(line);
}

function extractDates(line: string) {
  const match = line.match(/((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}|\b(?:19|20)\d{2}\b)\s*(?:-|to|–|—|â€“|â€”)\s*((?:present|current|now)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}|\b(?:19|20)\d{2}\b)?/i);
  if (!match) return { start: '', end: '' };
  return {
    start: normalizeDateToken(match[1]),
    end: normalizeDateToken(match[2] || ''),
  };
}

function normalizeDateToken(token: string) {
  if (!token) return '';
  const clean = token.replace(/\u2013|\u2014/g, '-').trim();
  if (/present|current|now/i.test(clean)) return 'Present';
  return clean;
}

function stripDates(line: string) {
  return line
    .replace(/\b(20\d{2}|19\d{2})\b/g, '')
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, '')
    .replace(/\b(present|current|now)\b/gi, '')
    .replace(/[-–—â€“â€”]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function looksLikeProjectTitle(line: string) {
  return /project|capstone|thesis|research/i.test(line);
}

function isMeaningfulExperience(item: ExperienceItem) {
  return Boolean(item.company.trim() || item.role.trim() || item.startDate.trim() || item.endDate.trim() || item.highlights.some((line) => line.trim().length > 0));
}

function uniqueLines(lines: string[]) {
  const set = new Set<string>();
  const out: string[] = [];
  for (const line of lines.map((line) => line.trim()).filter(Boolean)) {
    const key = line.toLowerCase();
    if (set.has(key)) continue;
    set.add(key);
    out.push(line);
  }
  return out;
}

function normalizeCompany(company: string) {
  return company.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pickEarlierDate(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  return toSortValue(a, false) <= toSortValue(b, false) ? a : b;
}

function pickLaterDate(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  if (/present/i.test(a)) return a;
  if (/present/i.test(b)) return b;
  return toSortValue(a, true) >= toSortValue(b, true) ? a : b;
}

function toSortValue(token: string, end: boolean) {
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



