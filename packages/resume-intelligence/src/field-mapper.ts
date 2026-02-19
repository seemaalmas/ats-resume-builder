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
import { normalizeHeading } from './section-normalizer.js';

export type MappedResumeResult = ParsedResume & {
  signals: {
    roleCount: number;
    distinctCompanyCount: number;
    rolesWithDateCount: number;
    roleCompanyPatternCount: number;
    estimatedTotalMonths: number;
  };
};

const ROLE_HINT_RE = /\b(engineer|developer|manager|designer|analyst|intern|lead|architect|specialist|consultant|director|head|officer|administrator|coordinator|principal|staff|qa|devops|product|owner|founder|avp|assistant vice president|vice president)\b/i;
const PLACEHOLDER_ONLY_RE = /^(?:-|n\/a|na|null|none|not available)$/i;
const TITLE_BLOCKLIST = new Set([
  'skills',
  'soft skills',
  'technical skills',
  'work experience',
  'experience',
  'professional experience',
  'employment',
  'employment history',
  'work history',
  'education',
  'professional summary',
  'summary',
  'communication',
  'teamwork',
  'leadership',
  'problem solving',
  'problem-solving',
  'languages',
  'achievements',
]);
const CONTACT_LABEL_RE = /\b(email|mobile|phone|contact|linkedin|github|portfolio|address|location)\b/i;
const NAME_BLOCKLIST_RE = /\b(skills?|technical|soft|experience|employment|education|communication|teamwork|leadership|problem[-\s]?solving|languages|achievements?|summary|profile|objective)\b/i;
const COMPANY_SUFFIX_RE = /\b(inc|llc|ltd|corp|company|technologies|systems|labs|solutions|group|studio|partners|bank|consulting|digital)\b/i;

type HeaderMapping = {
  contact?: Contact;
  fullName: string;
  headline: string;
};

export function mapParsedResume(parsed: ParsedResumeText): MappedResumeResult {
  const summary = mapSummary(parsed.sections);
  const skills = mapSkills(parsed.sections);
  const experienceRaw = sortExperienceChronological(
    mergeExperienceByCompany(mapExperience(parsed)),
  );
  const educationRaw = mapEducation(parsed.sections);
  const projects = mapProjects(parsed.sections);
  const certifications = mapCertifications(parsed.sections);
  const header = mapHeader(parsed.lines);
  const contact = header.contact;
  const title = guessTitle(parsed.lines, header);
  const mappedUnsorted = getUnmappedText(parsed.sections);
  const experienceSanitized = sanitizeExperienceForStrictSave(experienceRaw);
  const educationSanitized = sanitizeEducationForStrictSave(educationRaw);
  const unmappedText = mergeUnmappedText(
    mappedUnsorted,
    [...experienceSanitized.rejected, ...educationSanitized.rejected],
  );
  const resumeText = [
    summary,
    skills.join(' '),
    experienceSanitized.items.map((item) => `${item.role} ${item.company}`).join(' '),
  ].join(' ');
  const levelResult = computeExperienceLevel({ resumeText, experience: experienceSanitized.items });

  const validated = ParsedResumeSchema.parse({
    title,
    contact,
    summary,
    skills,
    experience: experienceSanitized.items,
    education: educationSanitized.items,
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
  return fallback.join(' ').slice(0, 400).trim();
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
    .map((token) => cleanLooseText(token))
    .filter((token) => {
      if (token.length < 2 || token.length > 36) return false;
      const words = token.split(/\s+/).filter(Boolean);
      if (words.length > 2) return false;
      if (/^(and|or|in|on|with|for|to|of|the)$/i.test(words[0] || '')) return false;
      if (/[.!?]/.test(token)) return false;
      if (/@|https?:\/\/|www\./i.test(token)) return false;
      if (CONTACT_LABEL_RE.test(token)) return false;
      if (NAME_BLOCKLIST_RE.test(token)) return false;
      if (isLikelyNameLine(token)) return false;
      if (ROLE_HINT_RE.test(token) && token.split(/\s+/).length >= 2) return false;
      if (/^\#/.test(token)) return false;
      if (/\b\d+\s+of\s+\d+\b/i.test(token)) return false;
      if (/\d{3,}/.test(token)) return false;
      return /[a-z]/i.test(token);
    });
  return Array.from(new Set(tokens)).slice(0, 20);
}

function mapExperience(parsed: ParsedResumeText) {
  const source = buildExperienceSource(parsed);
  const blocks: ExperienceItem[] = [];
  let current: ExperienceItem | null = null;
  let currentCompany = '';
  let pendingRole = '';
  const pendingDateBlockIndexes: number[] = [];

  // Keep role/company/date grouping stable while preserving multiple roles under one company.
  const pushCurrent = () => {
    if (!current) return;
    current.company = cleanCompanyName(current.company);
    current.role = cleanLooseText(current.role);
    current.startDate = normalizeDateToken(cleanLooseText(current.startDate));
    current.endDate = normalizeDateToken(cleanLooseText(current.endDate));
    current.highlights = uniqueLines(current.highlights.map((line) => cleanLooseText(line)).filter(Boolean));
    if (current.company) currentCompany = current.company;
    if (isMeaningfulExperience(current)) {
      blocks.push(current);
      if (current.company.trim() && current.role.trim() && !current.startDate && !current.endDate) {
        pendingDateBlockIndexes.push(blocks.length - 1);
      }
    }
    current = null;
  };

  const startCurrent = (seed: { company?: string; role?: string; startDate?: string; endDate?: string }) => {
    pushCurrent();
    const company = cleanCompanyName(seed.company || currentCompany);
    const role = cleanLooseText(seed.role || '');
    const startDate = normalizeDateToken(cleanLooseText(seed.startDate || ''));
    const endDate = normalizeDateToken(cleanLooseText(seed.endDate || ''));
    if (company) currentCompany = company;
    current = { company, role, startDate, endDate, highlights: [] };
    pendingRole = '';
  };

  const assignDatesToCurrentOrRecent = (startDate: string, endDate: string) => {
    if (!startDate && !endDate) return;
    while (pendingDateBlockIndexes.length) {
      const nextIndex = pendingDateBlockIndexes[0];
      const item = blocks[nextIndex];
      if (!item || item.startDate || item.endDate) {
        pendingDateBlockIndexes.shift();
        continue;
      }
      item.startDate = startDate || item.startDate;
      item.endDate = endDate || item.endDate;
      pendingDateBlockIndexes.shift();
      return;
    }
    if (current && (current.company.trim() || current.role.trim()) && !current.startDate && !current.endDate) {
      current.startDate = startDate;
      current.endDate = endDate;
      return;
    }
  };

  const appendBulletToNearestBlock = (bullet: string) => {
    if (current) {
      current.highlights.push(bullet);
      return true;
    }
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const item = blocks[i];
      if (currentCompany && normalizeCompany(item.company) !== normalizeCompany(currentCompany)) {
        continue;
      }
      item.highlights = uniqueLines([...item.highlights, bullet]);
      return true;
    }
    return false;
  };

  for (const line of source) {
    const normalizedLine = cleanLooseText(line);
    if (!normalizedLine) continue;

    const heading = normalizeHeading(line);
    if (heading && heading !== 'experience') {
      if (/education|projects|certifications|skills/.test(heading)) {
        pushCurrent();
      }
      continue;
    }

    if (isCrossSectionBoundary(line)) {
      if (isDateLine(normalizedLine)) {
        const dates = extractDates(normalizedLine);
        assignDatesToCurrentOrRecent(dates.start, dates.end);
      }
      pushCurrent();
      continue;
    }

    const bullet = extractBulletLine(line);
    if (bullet) {
      if (pendingRole && currentCompany && !current) {
        startCurrent({ company: currentCompany, role: pendingRole });
      }
      if (!appendBulletToNearestBlock(bullet)) {
        current = { company: cleanCompanyName(currentCompany), role: '', startDate: '', endDate: '', highlights: [bullet] };
      }
      continue;
    }

    if (isStandaloneDateLine(normalizedLine)) {
      if (pendingRole && currentCompany && !current) {
        startCurrent({ company: currentCompany, role: pendingRole });
      }
      const dates = extractDates(normalizedLine);
      assignDatesToCurrentOrRecent(dates.start, dates.end);
      continue;
    }

    if (
      looksLikeRole(normalizedLine) &&
      looksLikeRoleTitle(normalizedLine) &&
      !looksLikeCompany(normalizedLine) &&
      !looksLikeEducationRoleLine(normalizedLine) &&
      !isDateLine(normalizedLine) &&
      !/@|\sat\s|\s\|\s|\s-\s|\s—\s|\s–\s|â€”|â€“/i.test(normalizedLine)
    ) {
      if (current) pushCurrent();
      pendingRole = normalizedLine;
      continue;
    }

    const companyHeading = parseCompanyHeading(normalizedLine);
    if (companyHeading) {
      if (pendingRole) {
        startCurrent({ company: companyHeading, role: pendingRole });
        continue;
      }
      if (current && current.company && current.role && normalizeCompany(current.company) !== normalizeCompany(companyHeading)) {
        pushCurrent();
      }
      currentCompany = companyHeading;
      if (current && !current.company) current.company = companyHeading;
      continue;
    }

    const fullHeader = parseExperienceHeader(normalizedLine);
    if (fullHeader && (fullHeader.role || fullHeader.company)) {
      startCurrent(fullHeader);
      continue;
    }

    const roleUnderCompany = parseRoleWithOptionalDates(normalizedLine, currentCompany);
    if (roleUnderCompany) {
      startCurrent(roleUnderCompany);
      continue;
    }

    if (!current && currentCompany && looksLikeRole(normalizedLine) && looksLikeRoleTitle(normalizedLine)) {
      startCurrent({ company: currentCompany, role: normalizedLine });
      continue;
    }

    if (current && !current.role && looksLikeRole(normalizedLine) && looksLikeRoleTitle(normalizedLine)) {
      current.role = normalizedLine;
      continue;
    }

    if (!current) continue;
    if (normalizedLine.length > 10) current.highlights.push(normalizedLine);
  }

  pushCurrent();
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
    const normalizedLine = cleanLooseText(line);
    if (!normalizedLine) continue;
    if (looksLikeEducationDegreeLine(normalizedLine)) {
      if (current && (current.institution || current.degree)) blocks.push(current);
      const dates = extractDates(normalizedLine);
      current = {
        institution: '',
        degree: normalizedLine,
        startDate: dates.start,
        endDate: dates.end,
        details: [],
      };
      continue;
    }
    if (looksLikeEducationInstitutionLine(normalizedLine)) {
      if (!current) {
        current = { institution: normalizedLine, degree: '', startDate: '', endDate: '', details: [] };
        continue;
      }
      if (!current.institution) {
        current.institution = normalizedLine;
        continue;
      }
      if (current.institution && current.degree) {
        blocks.push(current);
        current = { institution: normalizedLine, degree: '', startDate: '', endDate: '', details: [] };
        continue;
      }
    }
    if (isStandaloneDateLine(normalizedLine) && current) {
      const dates = extractDates(normalizedLine);
      current.startDate = current.startDate || dates.start;
      current.endDate = current.endDate || dates.end;
      continue;
    }
    if (looksLikeRole(normalizedLine) && !looksLikeEducationDegreeLine(normalizedLine)) {
      if (current && (current.institution || current.degree)) blocks.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const detail = extractBulletLine(line);
    if (detail) {
      current.details.push(detail);
    }
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

function mapHeader(lines: string[]): HeaderMapping {
  const cleanLines = lines.map((line) => cleanLooseText(line)).filter(Boolean);
  const allText = cleanLines.join(' ');
  const anchorIndex = findContactAnchorIndex(cleanLines);
  const candidateIndexes = new Set<number>();
  const anchorStart = anchorIndex >= 0 ? Math.max(0, anchorIndex - 8) : 0;
  const anchorEnd = anchorIndex >= 0 ? Math.min(cleanLines.length - 1, anchorIndex + 2) : Math.min(cleanLines.length - 1, 14);
  for (let i = anchorStart; i <= anchorEnd; i += 1) candidateIndexes.add(i);
  for (let i = 0; i < Math.min(cleanLines.length, 16); i += 1) candidateIndexes.add(i);

  let bestName = '';
  let bestNameIndex = -1;
  let bestNameScore = Number.NEGATIVE_INFINITY;
  for (const index of candidateIndexes) {
    const candidate = cleanLines[index];
    const score = scoreNameCandidate(candidate, index, anchorIndex);
    if (score <= bestNameScore) continue;
    bestNameScore = score;
    bestName = candidate;
    bestNameIndex = index;
  }
  if (bestNameScore < 0) {
    bestName = '';
    bestNameIndex = -1;
  }

  const headline = extractHeadline(cleanLines, bestNameIndex);
  const emailMatch = allText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = allText.match(/(?:mobile(?:\s*no)?|phone|contact)?[:\s-]*(\+?\d[\d\s().-]{7,}\d)/i);
  const links = cleanLines
    .flatMap((line) => {
      const matches = Array.from(line.matchAll(/https?:\/\/[^\s]+/gi)).map((item) => cleanLooseText(item[0] || ''));
      if (matches.length) return matches;
      if (/linkedin\.com|github\.com|portfolio|website/i.test(line)) return [line];
      return [];
    })
    .map((line) => cleanLooseText(line))
    .filter(Boolean)
    .slice(0, 3);
  const location = extractLocation(cleanLines);

  if (bestName.length < 2 && !emailMatch && !phoneMatch) {
    return { fullName: '', headline: '', contact: undefined };
  }

  return {
    fullName: bestName,
    headline,
    contact: bestName.length >= 2
      ? {
        fullName: bestName,
        email: emailMatch ? emailMatch[0] : undefined,
        phone: phoneMatch ? cleanLooseText(phoneMatch[1] || phoneMatch[0]) : undefined,
        location: location || undefined,
        links: links.length ? links : undefined,
      }
      : undefined,
  };
}

function guessTitle(lines: string[], header: HeaderMapping) {
  const headlineTitle = normalizeHeadlineForTitle(header.headline);
  if (headlineTitle && !isBlockedTitleValue(headlineTitle)) {
    return headlineTitle;
  }

  const roleCandidate = lines
    .map((line) => cleanLooseText(line))
    .find((line) => {
      if (!line) return false;
      if (isBlockedTitleValue(line)) return false;
      if (line.length > 96 || /@|https?:\/\/|www\./i.test(line)) return false;
      if (!ROLE_HINT_RE.test(line)) return false;
      if (!/[|/]|(?:\s[-–—]\s)/.test(line)) return false;
      return true;
    });
  if (roleCandidate) {
    return normalizeHeadlineForTitle(roleCandidate);
  }

  const fullName = cleanLooseText(header.contact?.fullName || header.fullName || '');
  if (fullName && !isBlockedTitleValue(fullName)) {
    return `${fullName} Resume`;
  }

  return 'Software Engineer Resume';
}

function findContactAnchorIndex(lines: string[]) {
  return lines.findIndex((line) => /@|linkedin\.com|github\.com|mobile|phone|contact|email/i.test(line));
}

function scoreNameCandidate(line: string, index: number, anchorIndex: number) {
  if (!isLikelyNameLine(line)) return Number.NEGATIVE_INFINITY;
  const words = line.split(/\s+/).filter(Boolean);
  let score = 12;
  if (words.length === 2) score += 4;
  else if (words.length === 3) score += 2;
  else score += 1;
  const strictName = /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}$/.test(line);
  if (strictName) score += 6;
  if (anchorIndex >= 0) {
    if (index <= anchorIndex) score += 2;
    score -= Math.abs(anchorIndex - index) * 0.3;
  }
  if (ROLE_HINT_RE.test(line)) score -= 6;
  return score;
}

function isLikelyNameLine(line: string) {
  const cleaned = cleanLooseText(line);
  if (!cleaned || cleaned.length > 56 || cleaned.length < 3) return false;
  if (isBlockedTitleValue(cleaned)) return false;
  if (NAME_BLOCKLIST_RE.test(cleaned)) return false;
  if (CONTACT_LABEL_RE.test(cleaned)) return false;
  if (/@|https?:\/\/|www\./i.test(cleaned)) return false;
  if (/[|/:]/.test(cleaned)) return false;
  if (/\d/.test(cleaned)) return false;
  if (COMPANY_SUFFIX_RE.test(cleaned)) return false;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[A-Z][A-Za-z.'-]*$/.test(word));
}

function extractHeadline(lines: string[], nameIndex: number) {
  if (nameIndex < 0) return '';
  for (let offset = 1; offset <= 2; offset += 1) {
    const candidate = cleanLooseText(lines[nameIndex + offset] || '');
    if (!candidate) continue;
    if (isLikelyHeadlineLine(candidate)) return candidate;
  }
  return '';
}

function isLikelyHeadlineLine(line: string) {
  const cleaned = cleanLooseText(line);
  if (!cleaned) return false;
  if (isBlockedTitleValue(cleaned)) return false;
  if (/@|https?:\/\/|www\./i.test(cleaned)) return false;
  if (/\d{6,}/.test(cleaned)) return false;
  if (cleaned.length < 8 || cleaned.length > 120) return false;
  const hasDelimiter = /[|/]|(?:\s[-–—]\s)/.test(cleaned);
  if (!hasDelimiter) return false;
  return ROLE_HINT_RE.test(cleaned);
}

function extractLocation(lines: string[]) {
  for (const line of lines) {
    if (/address\s*:/i.test(line)) {
      const match = line.match(/address\s*:\s*(.+?)(?:\s+date of birth|$)/i);
      const value = cleanLooseText(match ? match[1] : line.replace(/address\s*:/i, ''));
      if (value) return value;
    }
  }
  const fallback = lines.find((line) => /\b(remote|usa|united states|india|canada|uk)\b/i.test(line) || /\b[A-Z]{2}\s*\d{4,6}\b/.test(line));
  return cleanLooseText(fallback || '');
}

function isBlockedTitleValue(value: string) {
  const normalized = cleanLooseText(value).toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  if (TITLE_BLOCKLIST.has(normalized)) return true;
  return Boolean(normalizeHeading(value));
}

function normalizeHeadlineForTitle(value: string) {
  const cleaned = cleanLooseText(value);
  if (!cleaned) return '';
  return cleaned
    .replace(/\s*\|\s*/g, ' / ')
    .replace(/\s*[–—]\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
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

function sanitizeExperienceForStrictSave(items: ExperienceItem[]) {
  const cleanItems: ExperienceItem[] = [];
  const rejected: string[] = [];
  for (const item of items) {
    const company = cleanCompanyName(item.company);
    const role = cleanLooseText(item.role);
    const startDate = normalizeDateToken(cleanLooseText(item.startDate));
    const endDate = normalizeDateToken(cleanLooseText(item.endDate));
    const highlights = uniqueLines(
      item.highlights
        .map((line) => cleanLooseText(line))
        .filter((line) => isMeaningfulHighlight(line)),
    );

    const hasAnyContent = Boolean(company || role || startDate || endDate || highlights.length);
    if (!hasAnyContent) continue;
    if (company.length < 2 || role.length < 2) {
      rejected.push(buildRejectedLine('Experience', [role, company, startDate, endDate, ...highlights]));
      continue;
    }
    cleanItems.push({ company, role, startDate, endDate, highlights });
  }
  return { items: cleanItems, rejected };
}

function sanitizeEducationForStrictSave(items: EducationItem[]) {
  const cleanItems: EducationItem[] = [];
  const rejected: string[] = [];
  for (const item of items) {
    const institution = cleanLooseText(item.institution);
    const degree = cleanLooseText(item.degree);
    const startDate = normalizeDateToken(cleanLooseText(item.startDate));
    const endDate = normalizeDateToken(cleanLooseText(item.endDate));
    const details = item.details.map((line) => cleanLooseText(line)).filter(Boolean);

    const hasCore = Boolean(institution || degree);
    if (!hasCore) continue;
    const strictValid = (
      institution.length >= 2 &&
      degree.length >= 2 &&
      (startDate.length >= 4 || endDate.length >= 4)
    );
    if (!strictValid) {
      rejected.push(buildRejectedLine('Education', [degree, institution, startDate, endDate, ...details]));
      continue;
    }
    cleanItems.push({ institution, degree, startDate, endDate, details });
  }
  return { items: cleanItems, rejected };
}

function mergeUnmappedText(base: string, additions: string[]) {
  const merged = [base, ...additions]
    .map((line) => cleanLooseText(line))
    .filter(Boolean);
  return uniqueLines(merged).join('\n').trim();
}

function buildRejectedLine(prefix: string, parts: string[]) {
  const text = parts.map((part) => cleanLooseText(part)).filter(Boolean).join(' | ');
  return `From Upload (Unsorted): ${prefix}: ${text || 'Unstructured content'}`;
}

function cleanLooseText(value: string) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[|:;,\-–—_*•·/\\]+\s*/g, '')
    .replace(/\s*[|:;,\-–—_*•·/\\]+$/g, '')
    .trim();
  if (!text) return '';
  if (isPlaceholderValue(text)) return '';
  return text;
}

function isPlaceholderValue(value: string) {
  return /^[-–—_*•·|/\\]+$/.test(value) || PLACEHOLDER_ONLY_RE.test(value);
}

function collectLikelyExperienceLines(lines: string[]) {
  const output: string[] = [];
  for (const line of lines) {
    if (looksLikeExperienceHeader(line) || looksLikeCompany(line) || looksLikeRole(line) || line.startsWith('-') || isDateLine(line)) {
      output.push(line);
      continue;
    }
    if (output.length && line.length > 8) output.push(line);
  }
  return output;
}

function buildExperienceSource(parsed: ParsedResumeText) {
  const sectionLines = [
    ...(parsed.sections.experience || []),
    ...(parsed.sections.employment || []),
    ...(parsed.sections.work || []),
    ...(parsed.sections.career || []),
  ];
  const firstExperienceHeading = parsed.lines.findIndex((line) => normalizeHeading(line) === 'experience');
  if (firstExperienceHeading >= 0) {
    const tail = parsed.lines.slice(firstExperienceHeading + 1);
    return tail.length ? tail : sectionLines;
  }
  if (sectionLines.length) return sectionLines;
  return collectLikelyExperienceLines(parsed.sections.unmapped || []);
}

function looksLikeExperienceHeader(line: string) {
  if (!line || line.startsWith('-')) return false;
  const cleaned = cleanLooseText(line);
  if (!cleaned) return false;
  const hasDate = isDateLine(cleaned);
  const stripped = stripDates(cleaned);
  const hasSubstanceAfterDates = stripped.replace(/[@|]/g, ' ').replace(/\s+/g, ' ').trim().length >= 3;
  const hasRole = looksLikeRole(cleaned);
  const hasCompany = looksLikeCompany(cleaned);
  const hasDelimiter = /@|\sat\s|\s\|\s|\s-\s|\s—\s|\s–\s|â€”|â€“/i.test(line);
  if (hasDate && (hasRole || hasCompany || hasSubstanceAfterDates)) return true;
  return (hasRole && hasCompany) || (hasRole && hasDelimiter) || (hasDelimiter && hasSubstanceAfterDates);
}

function parseExperienceHeader(line: string) {
  if (looksLikeEducationRoleLine(line)) return null;
  if (!looksLikeExperienceHeader(line)) return null;
  const dates = extractDates(line);
  const stripped = stripDates(line);
  const split = splitRoleCompany(stripped);
  const role = cleanLooseText(split.role);
  const company = cleanCompanyName(split.company);
  if (!role && !company) return null;
  return {
    company,
    role,
    startDate: dates.start,
    endDate: dates.end,
  };
}

function parseRoleWithOptionalDates(line: string, currentCompany: string) {
  if (looksLikeEducationRoleLine(line)) return null;
  const dates = extractDates(line);
  const stripped = cleanLooseText(stripDates(line));
  if (!stripped) return null;
  const split = splitRoleCompany(stripped);
  const role = cleanLooseText(split.role);
  const company = cleanCompanyName(split.company);
  if (company && role && looksLikeRoleTitle(role)) {
    return { company, role, startDate: dates.start, endDate: dates.end };
  }
  if (!currentCompany || !role || !looksLikeRole(role) || !looksLikeRoleTitle(role)) return null;
  return {
    company: cleanCompanyName(currentCompany),
    role,
    startDate: dates.start,
    endDate: dates.end,
  };
}

function parseCompanyHeading(line: string) {
  const stripped = cleanLooseText(stripDates(line));
  if (!stripped) return '';
  const locationWrappedCompany = stripped.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (locationWrappedCompany) {
    const companyWithNoLocation = cleanCompanyName(stripped);
    if (looksLikeCompany(companyWithNoLocation)) {
      return companyWithNoLocation;
    }
  }
  const split = splitRoleCompany(stripped);
  if (split.company && !split.role) {
    return cleanCompanyName(split.company);
  }
  if (looksLikeCompany(stripped) && !looksLikeRole(stripped)) {
    return cleanCompanyName(stripped);
  }
  return '';
}

function extractBulletLine(line: string) {
  const match = String(line || '').match(/^\s*[-*•·]\s*(.+)$/);
  if (!match) return '';
  return cleanLooseText(match[1] || '');
}

function cleanCompanyName(value: string) {
  const normalized = cleanLooseText(value);
  if (!normalized) return '';
  const noTrailingDelimiter = normalized
    .replace(/[|@-]\s*$/g, '')
    .replace(/\(([^)]+)\)\s*$/g, '')
    .trim();
  const parts = noTrailingDelimiter.split(',').map((part) => cleanLooseText(part)).filter(Boolean);
  if (parts.length >= 2 && looksLikeLocationFragment(parts.slice(1).join(' ')) && looksLikeCompany(parts[0])) {
    return parts[0];
  }
  return noTrailingDelimiter;
}

function looksLikeLocationFragment(value: string) {
  return /\b(remote|usa|united states|india|canada|uk|australia|singapore)\b/i.test(value)
    || /\b[A-Z]{2}\b/.test(value);
}

function splitRoleCompany(line: string) {
  const normalized = cleanLooseText(line.replace(/\s{2,}/g, ' '));
  if (!normalized) return { role: '', company: '' };
  if (normalized.includes('@')) {
    const parts = normalized.split('@');
    if (parts.length === 2) return { role: cleanLooseText(parts[0]), company: cleanCompanyName(parts[1]) };
  }
  if (/\sat\s/i.test(normalized)) {
    const parts = normalized.split(/\sat\s/i);
    if (parts.length === 2) return { role: cleanLooseText(parts[0]), company: cleanCompanyName(parts[1]) };
  }
  for (const delimiter of [' — ', ' – ', ' - ', ' | ', ' â€” ']) {
    if (normalized.includes(delimiter)) {
      const parts = normalized.split(delimiter);
      if (parts.length >= 2) {
        const left = cleanLooseText(parts[0]);
        const right = cleanLooseText(parts.slice(1).join(delimiter));
        const leftLooksRole = looksLikeRole(left);
        const rightLooksRole = looksLikeRole(right);
        const leftLooksCompany = looksLikeCompany(left);
        const rightLooksCompany = looksLikeCompany(right);
        if (leftLooksCompany && rightLooksRole) return { role: right, company: cleanCompanyName(left) };
        if (rightLooksCompany && leftLooksRole) return { role: left, company: cleanCompanyName(right) };
        if (leftLooksRole && !rightLooksRole) return { role: left, company: cleanCompanyName(right) };
        if (rightLooksRole && !leftLooksRole) return { role: right, company: cleanCompanyName(left) };
        if (leftLooksCompany && !rightLooksCompany) return { role: right, company: cleanCompanyName(left) };
        if (rightLooksCompany && !leftLooksCompany) return { role: left, company: cleanCompanyName(right) };
        return { role: left, company: cleanCompanyName(right) };
      }
    }
  }
  if (looksLikeCompany(normalized)) return { role: '', company: cleanCompanyName(normalized) };
  return { role: normalized, company: '' };
}

function looksLikeRole(line: string) {
  return ROLE_HINT_RE.test(line);
}

function looksLikeRoleTitle(line: string) {
  const cleaned = cleanLooseText(line);
  if (!cleaned) return false;
  if (cleaned.length > 80) return false;
  if (/[.!?]$/.test(cleaned)) return false;
  if (cleaned.includes(',')) return false;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 8) return false;
  if (!/^[A-Z]/.test(cleaned)) return false;
  return true;
}

function looksLikeEducationRoleLine(line: string) {
  const cleaned = cleanLooseText(line);
  if (!cleaned) return false;
  return /\b(b\.?e|btech|mtech|bachelor|master|associate|diploma|phd|education)\b/i.test(cleaned);
}

function looksLikeEducationDegreeLine(line: string) {
  return /\b(b\.?e|btech|mtech|bachelor|master|associate|diploma|phd|education)\b/i.test(line);
}

function looksLikeEducationInstitutionLine(line: string) {
  return /\b(university|college|school|institute|academy)\b/i.test(line);
}

function looksLikeCompany(line: string) {
  const cleaned = cleanLooseText(line);
  if (!cleaned) return false;
  if (looksLikeRole(cleaned) && !/(inc|llc|ltd|corp|company|technologies|systems|labs|solutions|group|studio|partners|bank|university|health|consulting|digital)\b/i.test(cleaned)) {
    return false;
  }
  if (/(inc|llc|ltd|corp|company|technologies|systems|labs|solutions|group|studio|partners|bank|university|health|consulting|digital)\b/i.test(cleaned)) {
    return true;
  }
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2 && tokens.length <= 7) {
    const titleCaseTokens = tokens.filter((token) => /^[A-Z][A-Za-z0-9&'.-]*$/.test(token)).length;
    return titleCaseTokens >= Math.ceil(tokens.length * 0.6);
  }
  return false;
}

function mergeExperienceByCompany(experience: ExperienceItem[]) {
  const map = new Map<string, ExperienceItem>();
  for (const item of experience) {
    if (!isMeaningfulExperience(item)) continue;
    const company = cleanCompanyName(item.company);
    const role = cleanLooseText(item.role);
    const startDate = normalizeDateToken(cleanLooseText(item.startDate));
    const endDate = normalizeDateToken(cleanLooseText(item.endDate));
    const key = `${normalizeCompany(company)}|${role.toLowerCase().replace(/[^a-z0-9]/g, '')}|${startDate}|${endDate}`;
    if (!map.has(key)) {
      map.set(key, {
        ...item,
        company,
        role,
        startDate,
        endDate,
        highlights: uniqueLines(item.highlights.map((line) => cleanLooseText(line)).filter(Boolean)),
      });
      continue;
    }
    const current = map.get(key)!;
    current.role = current.role || role;
    current.company = current.company || company;
    current.startDate = pickEarlierDate(current.startDate, startDate);
    current.endDate = pickLaterDate(current.endDate, endDate);
    current.highlights = uniqueLines([...current.highlights, ...item.highlights.map((line) => cleanLooseText(line)).filter(Boolean)]);
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

function isStandaloneDateLine(line: string) {
  if (!isDateLine(line)) return false;
  const stripped = cleanLooseText(stripDates(line));
  if (!stripped) return true;
  return !/[a-z0-9]/i.test(stripped);
}

function isCrossSectionBoundary(line: string) {
  return /--\s*\d+\s*of\s*\d+\s*--\s*(education|projects?|certifications?|licenses?|skills?)\b/i.test(line);
}

function extractDates(line: string) {
  const dateToken = '(?:' +
    '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\s+\\d{4}' +
    '|\\b(?:19|20)\\d{2}\\b' +
    '|\\b\\d{1,2}[/-](?:19|20)\\d{2}\\b' +
    ')';
  const rangePattern = new RegExp(`(${dateToken})\\s*(?:-|to|–|—|â€“|â€”)\\s*((?:present|current|now)|${dateToken})?`, 'i');
  const match = line.match(rangePattern);
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
    .replace(/\b\d{1,2}[/-](19\d{2}|20\d{2})\b/gi, '')
    .replace(/\b(20\d{2}|19\d{2})\b/g, '')
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, '')
    .replace(/\b(present|current|now)\b/gi, '')
    .replace(/[-–—â€“â€”|@]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function looksLikeProjectTitle(line: string) {
  return /project|capstone|thesis|research/i.test(line);
}

function isMeaningfulHighlight(line: string) {
  return /[a-z0-9]/i.test(line) && !/^[-–—_*•·|/\\]+$/.test(line);
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



