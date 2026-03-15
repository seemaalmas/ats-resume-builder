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
import { enhanceExperienceExtraction } from './experience-enhancer.js';

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
const LEGACY_BULLET_PREFIX_RE = /^\s*(?:[-*•·]+|\d{1,3}[.)]|[a-z][.)])?\s*(impact|achievement|result|highlights?|accomplishment)s?:\s*/i;

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
  const shouldEnhanceExperience = experienceSanitized.items.length < 1
    || experienceSanitized.items.some((item) => !item.company || !item.role);
  const experienceAfterEnhancement = shouldEnhanceExperience
    ? enhanceExperienceExtraction({
      rawText: parsed.lines.join('\n'),
      parsed,
      currentExperience: experienceSanitized.items,
    })
    : experienceSanitized.items;
  const finalExperienceSanitized = shouldEnhanceExperience
    ? sanitizeExperienceForStrictSave(experienceAfterEnhancement)
    : experienceSanitized;
  const unmappedText = mergeUnmappedText(
    mappedUnsorted,
    [...finalExperienceSanitized.rejected, ...educationSanitized.rejected],
  );
  const resumeText = [
    summary,
    skills.join(' '),
    finalExperienceSanitized.items.map((item) => `${item.role} ${item.company}`).join(' '),
  ].join(' ');
  const levelResult = computeExperienceLevel({ resumeText, experience: finalExperienceSanitized.items });

  const validated = ParsedResumeSchema.parse({
    title,
    contact,
    summary,
    skills,
    experience: finalExperienceSanitized.items,
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
    .flatMap((line) => {
      // Remove common leading labels like "Skills:", "Technical Skills:", etc.
      const cleaned = line.replace(/^(?:skills?|technical\s+skills?|core\s+skills?|key\s+skills?|technologies)\s*:?\s*/i, '');
      // Split on common delimiters: comma, semicolon, pipe, bullet, middot
      return cleaned.split(/,|;|\||\u00b7|\u2022|\u25e6|\u25aa|\u25cf|â€¢|Â·/);
    })
    .map((token) => cleanLooseText(token))
    .filter((token) => {
      if (token.length < 2 || token.length > 50) return false;
      const words = token.split(/\s+/).filter(Boolean);
      if (words.length > 4) return false;
      if (/^(and|or|in|on|with|for|to|of|the)$/i.test(words[0] || '')) return false;
      if (/[!?]/.test(token)) return false;
      // Reject sentence-ending periods but allow tech names like "Node.js", "ASP.NET", "Vue.js"
      if (/\.\s/.test(token) || /\.$/.test(token)) return false;
      if (/@|https?:\/\/|www\./i.test(token)) return false;
      if (CONTACT_LABEL_RE.test(token)) return false;
      if (NAME_BLOCKLIST_RE.test(token)) return false;
      if (isLikelyNameLine(token)) return false;
      if (ROLE_HINT_RE.test(token) && token.split(/\s+/).length >= 3) return false;
      if (/^\#/.test(token)) return false;
      if (/\b\d+\s+of\s+\d+\b/i.test(token)) return false;
      if (/\d{3,}/.test(token)) return false;
      return /[a-z]/i.test(token);
    });
  return Array.from(new Set(tokens)).slice(0, 30);
}

function mapExperience(parsed: ParsedResumeText) {
  const source = buildExperienceSource(parsed);
  const blocks: ExperienceItem[] = [];
  let current: ExperienceItem | null = null;
  let currentCompany = '';
  let pendingRole = '';
  let pendingStartDate = '';
  let pendingEndDate = '';
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
    pendingStartDate = '';
    pendingEndDate = '';
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

  for (const rawLine of source) {
    const normalizedSourceLine = normalizeLegacyBulletPrefix(rawLine);
    const normalizedLine = cleanLooseText(normalizedSourceLine);
    if (!normalizedLine) continue;
    const heading = normalizeHeading(normalizedSourceLine);
    if (heading && heading !== 'experience') {
      pushCurrent();
      break; // Stop processing — we've left the experience section
    }

    if (isCrossSectionBoundary(normalizedSourceLine)) {
      if (isDateLine(normalizedLine)) {
        const dates = extractDates(normalizedLine);
        assignDatesToCurrentOrRecent(dates.start, dates.end);
      }
      pushCurrent();
      continue;
    }

    // Skip "Technologies - ..." or "Technologies: ..." lines — treat as highlights, not company/role
    if (/^Technologies\s*[-:]/i.test(normalizedLine)) {
      if (current) {
        current.highlights.push(normalizedLine);
      }
      continue;
    }

    const bullet = extractBulletLine(normalizedSourceLine);
    if (bullet) {
      if (pendingRole && currentCompany && !current) {
        startCurrent({ company: currentCompany, role: pendingRole, startDate: pendingStartDate, endDate: pendingEndDate });
      }
      if (!appendBulletToNearestBlock(bullet)) {
        current = { company: cleanCompanyName(currentCompany), role: '', startDate: '', endDate: '', highlights: [bullet] };
      }
      continue;
    }

    if (isStandaloneDateLine(normalizedLine)) {
      if (pendingRole && !current) {
        // Don't start entry yet — the company line typically follows the date.
        // Store dates as pending so they can be used when the company is found.
        const dates = extractDates(normalizedLine);
        pendingStartDate = dates.start;
        pendingEndDate = dates.end;
      } else {
        const dates = extractDates(normalizedLine);
        assignDatesToCurrentOrRecent(dates.start, dates.end);
      }
      continue;
    }

    if (
      looksLikeRole(normalizedLine) &&
      looksLikeRoleTitle(normalizedLine) &&
      !looksLikeCompany(normalizedLine) &&
      !looksLikeEducationRoleLine(normalizedLine) &&
      !isDateLine(normalizedLine) &&
      !/@|\sat\s|\s\|\s|\s-\s|\s—\s|\s–\s|â€”|â€”/i.test(normalizedLine)
    ) {
      if (current) pushCurrent();
      // If there was a previous pending role with dates but no company found,
      // flush it as an entry with the last-known company before setting the new role.
      if (pendingRole && (pendingStartDate || pendingEndDate)) {
        startCurrent({ company: currentCompany, role: pendingRole, startDate: pendingStartDate, endDate: pendingEndDate });
        pushCurrent();
      }
      pendingRole = normalizedLine;
      continue;
    }

    const companyHeading = parseCompanyHeading(normalizedLine);
    if (companyHeading) {
      if (pendingRole) {
        startCurrent({ company: companyHeading, role: pendingRole, startDate: pendingStartDate, endDate: pendingEndDate });
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

  // Flush any remaining pending role with dates
  if (pendingRole && (pendingStartDate || pendingEndDate)) {
    startCurrent({ company: currentCompany, role: pendingRole, startDate: pendingStartDate, endDate: pendingEndDate });
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

  // Even when no name is found, return contact with email/phone/location/links
  // so that ATS PDF round-trips still recover contact info.
  return {
    fullName: bestName,
    headline,
    contact: {
      fullName: bestName,
      email: emailMatch ? emailMatch[0] : undefined,
      phone: phoneMatch ? cleanLooseText(phoneMatch[1] || phoneMatch[0]) : undefined,
      location: location || undefined,
      links: links.length ? links : undefined,
    },
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
      if (line.length > 140 || /@|https?:\/\/|www\./i.test(line)) return false;
      if (!ROLE_HINT_RE.test(line)) return false;
      if (!/[|/]|(?:\s[-–—]\s)/.test(line)) return false;
      // Reject lines that contain date ranges (these are experience entries, not titles)
      if (/\b\d{1,2}[/-]\d{4}\b/.test(line) || /\b(20\d{2}|19\d{2})[-/]\d{1,2}\b/.test(line)) return false;
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
  // Search up to 10 lines after the name — contact info (mobile, email, address)
  // often sits between the name and the headline/tagline.
  const searchLimit = Math.min(lines.length, nameIndex + 11);
  for (let idx = nameIndex + 1; idx < searchLimit; idx += 1) {
    const candidate = cleanLooseText(lines[idx] || '');
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
  if (cleaned.length < 8 || cleaned.length > 140) return false;
  const hasDelimiter = /[|/]|(?:\s[-–—]\s)/.test(cleaned);
  if (!hasDelimiter) return false;
  return ROLE_HINT_RE.test(cleaned);
}

function extractLocation(lines: string[]) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/address\s*:/i.test(line)) {
      const match = line.match(/address\s*:\s*(.+?)(?:\s+date of birth|$)/i);
      const value = cleanLooseText(match ? match[1] : line.replace(/address\s*:/i, ''));
      if (value) return value;
      // Address label on its own line — check the next non-empty line
      for (let j = i + 1; j < Math.min(lines.length, i + 3); j += 1) {
        const next = cleanLooseText(lines[j]);
        if (!next) continue;
        // Skip if next line looks like another label or section heading
        if (CONTACT_LABEL_RE.test(next) || normalizeHeading(lines[j])) break;
        return next;
      }
    }
  }
  // Fallback: look for lines that contain location-like patterns
  const fallback = lines.find((line) => {
    const cleaned = cleanLooseText(line);
    // Match city/ZIP patterns like "Wagholi, Pune - 411057"
    if (/\b\d{5,6}\b/.test(cleaned) && /,/.test(cleaned)) return true;
    return /\b(remote|usa|united states|india|canada|uk)\b/i.test(cleaned) || /\b[A-Z]{2}\s*\d{4,6}\b/.test(cleaned);
  });
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
      (institution.length >= 2 || degree.length >= 2)
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
  for (const rawLine of lines) {
    const line = normalizeLegacyBulletPrefix(rawLine);
    if (!line) continue;
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
  // Prefer section-parsed lines when available — the tail approach leaks
  // education/certification content into the experience mapper.
  if (sectionLines.length) {
    // Also collect experience-like lines from other sections (e.g. education)
    // that may contain experience entries due to PDF page breaks — but only
    // if those sections contain clear role+company patterns.
    const otherSections = Object.entries(parsed.sections)
      .filter(([key]) => !['experience', 'employment', 'work', 'career', 'unmapped'].includes(key));
    const otherLines = otherSections.flatMap(([, lines]) => lines);
    const hasRoleCompany = otherLines.some((l) => looksLikeRole(l) && looksLikeRoleTitle(l) && !looksLikeEducationRoleLine(l));
    if (hasRoleCompany) {
      const spillover = collectLikelyExperienceLines(otherLines);
      if (spillover.length) return [...sectionLines, ...spillover];
    }
    return sectionLines;
  }
  const firstExperienceHeading = parsed.lines.findIndex((line) => normalizeHeading(line) === 'experience');
  if (firstExperienceHeading >= 0) {
    const tail = parsed.lines.slice(firstExperienceHeading + 1);
    return tail.length ? tail : sectionLines;
  }
  // No explicit experience section — collect role-like lines from all sections
  const allLines = Object.values(parsed.sections).flat();
  return collectLikelyExperienceLines(allLines.length ? allLines : parsed.lines);
}

function looksLikeExperienceHeader(line: string) {
  const normalizedLine = normalizeLegacyBulletPrefix(line);
  if (!normalizedLine || normalizedLine.startsWith('-')) return false;
  const cleaned = cleanLooseText(normalizedLine);
  if (!cleaned) return false;
  const hasDate = isDateLine(cleaned);
  const stripped = stripDates(cleaned);
  const hasSubstanceAfterDates = stripped.replace(/[@|]/g, ' ').replace(/\s+/g, ' ').trim().length >= 3;
  const hasRole = looksLikeRole(cleaned);
  const hasCompany = looksLikeCompany(cleaned);
  const hasRoleCompanyPattern = Boolean(parseRoleCompanyPair(stripped));
  const hasDelimiter = /@|\sat\s|\s\|\s|\s-\s|\s—\s|\s–\s|â€”|â€“/i.test(cleaned);

  // New experiences must be role/company headers, not repeated bullet prefixes.
  if (hasDate) {
    return hasRoleCompanyPattern || (hasRole && hasCompany) || (hasDelimiter && hasRoleCompanyPattern);
  }
  return hasRoleCompanyPattern || (hasRole && hasCompany) || (hasRole && hasDelimiter && hasSubstanceAfterDates);
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
  return /\b(remote|usa|united states|india|canada|uk|australia|singapore|pune|mumbai|bangalore|bengaluru|delhi|hyderabad|chennai|kolkata|noida|gurgaon|gurugram|new york|san francisco|london|berlin|tokyo)\b/i.test(value)
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

  // Try comma-based “Role, Company” split BEFORE dash-based splits.
  // ATS-exported PDFs use “AVP - Full Stack Engineer, Citi Corp” where the dash
  // is part of the role title and the comma separates role from company.
  if (normalized.includes(',')) {
    const lastCommaIdx = normalized.lastIndexOf(',');
    const left = cleanLooseText(normalized.substring(0, lastCommaIdx));
    const right = cleanLooseText(normalized.substring(lastCommaIdx + 1));
    if (left && right && looksLikeCompany(right) && !looksLikeLocationFragment(right) && looksLikeRole(left)) {
      return { role: left, company: cleanCompanyName(right) };
    }
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

function parseRoleCompanyPair(line: string) {
  const split = splitRoleCompany(line);
  const role = cleanLooseText(split.role);
  const company = cleanCompanyName(split.company);
  if (!role || !company) return null;
  if (!looksLikeRole(role) && !looksLikeRoleTitle(role)) return null;
  if (!looksLikeCompany(company)) return null;
  return { role, company };
}

function normalizeLegacyBulletPrefix(line: string) {
  const raw = String(line || '');
  if (!LEGACY_BULLET_PREFIX_RE.test(raw)) return raw;
  const stripped = raw.replace(LEGACY_BULLET_PREFIX_RE, '').trim();
  if (!stripped) return '';
  return `- ${stripped}`;
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
  const cleaned = cleanLooseText(line);
  if (!cleaned) return false;
  // Match explicit institution words
  if (/\b(university|college|school|institute|academy|polytechnic|conservatory)\b/i.test(cleaned)) return true;
  // Match common Indian institution abbreviations (IIT, IIIT, NIT, BITS, etc.)
  if (/\b(IIT|IIIT|NIT|BITS|SPPU|VTU|JNTU|AKTU|MIT|DTU|NSIT)\b/.test(cleaned)) return true;
  // Reject dates, degrees, short abbreviations, and bullet points
  if (cleaned.length < 3) return false;
  if (isStandaloneDateLine(cleaned)) return false;
  if (looksLikeEducationDegreeLine(cleaned)) return false;
  if (/^[-•*]/.test(cleaned)) return false;
  // Title-case line within an education section that isn't a degree or date
  // is likely an institution name (e.g. "SPPU", "IIT Delhi", "Harvard")
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 8) {
    const titleCaseWords = words.filter((w) => /^[A-Z]/.test(w));
    if (titleCaseWords.length >= Math.ceil(words.length * 0.5)) return true;
  }
  return false;
}

function looksLikeCompany(line: string) {
  const cleaned = cleanLooseText(line);
  if (!cleaned) return false;
  // "Technologies - HTML, CSS, ..." or "Technologies: ..." is NOT a company
  if (/^Technologies\s*[-:]/i.test(cleaned)) return false;
  if (looksLikeRole(cleaned)) {
    // "Systems Engineer", "Systems Analyst", etc. are role titles, not companies
    if (/\bsystems?\s+(?:engineer|developer|analyst|administrator|architect|specialist)\b/i.test(cleaned)) {
      return false;
    }
    if (!/(inc|llc|ltd|corp|company|technologies|systems|labs|solutions|group|studio|partners|bank|university|health|consulting|digital)\b/i.test(cleaned)) {
      return false;
    }
  }
  if (/(inc|llc|ltd|corp|company|technologies|systems|labs|solutions|group|studio|partners|bank|university|health|consulting|digital)\b/i.test(cleaned)) {
    // Guard: long sentence-like lines that incidentally contain suffix words
    // (e.g. "Designed distributed systems handling 1M concurrent users") are
    // NOT company names. Real company names rarely exceed 6 words.
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
    if (wordCount <= 6) return true;
  }
  // Handle "Company, Location" pattern (e.g. "Ernst & Young, Pune")
  const commaParts = cleaned.split(',').map((part) => part.trim()).filter(Boolean);
  const mainPart = commaParts.length >= 2 ? commaParts[0] : cleaned;
  const tokens = mainPart.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2 && tokens.length <= 7) {
    const titleCaseTokens = tokens.filter((token) => /^[A-Z][A-Za-z0-9&'.-]*$/.test(token) || /^&$/.test(token)).length;
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
  const hasYear = /(\b(20\d{2}|19\d{2})\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b)/i.test(line);
  if (!hasYear) return false;
  // Check for date range separator: “ - “, “ to “, em-dash, en-dash, etc.
  if (/\s+-\s+|\bto\b|–|—|â€”|â€”/i.test(line)) return true;
  // YYYY-MM - YYYY-MM format (dashes within dates and between dates)
  if (/\b(20\d{2}|19\d{2})[-/]\d{1,2}\b.*\s+-\s+.*\b(20\d{2}|19\d{2})/i.test(line)) return true;
  // MM/YYYY - MM/YYYY format
  if (/\b\d{1,2}[/-](20\d{2}|19\d{2})\b.*\s+-\s+.*\b\d{1,2}[/-](20\d{2}|19\d{2})/i.test(line)) return true;
  return false;
}

function isStandaloneDateLine(line: string) {
  if (!isDateLine(line)) return false;
  const stripped = cleanLooseText(
    stripDates(line)
      .replace(/\b(to|till|until|through)\b/gi, '') // remove date range separators
  );
  if (!stripped) return true;
  return !/[a-z0-9]/i.test(stripped);
}

function isCrossSectionBoundary(line: string) {
  return /--\s*\d+\s*of\s*\d+\s*--\s*(education|projects?|certifications?|licenses?|skills?)\b/i.test(line);
}

function extractDates(line: string) {
  const dateToken = '(?:' +
    '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\s+\\d{4}' +
    '|\\b(?:19|20)\\d{2}[-/]\\d{1,2}\\b' +     // YYYY-MM or YYYY/MM format
    '|\\b\\d{1,2}[/-](?:19|20)\\d{2}\\b' +      // MM/YYYY or MM-YYYY format
    '|\\b(?:19|20)\\d{2}\\b' +                   // bare YYYY (must be last to not consume YYYY-MM)
    ')';
  // Use “ - “ (with spaces) or “to” or em/en-dash as range separator to avoid
  // matching the “-” inside YYYY-MM tokens
  const rangePattern = new RegExp(`(${dateToken})\\s*(?:\\s-\\s|\\bto\\b|–|—|â€”|â€”)\\s*((?:present|current|now|till\\s*date)|${dateToken})?`, 'i');
  const match = line.match(rangePattern);
  // Also handle bare YYYY-YYYY (no spaces around dash, e.g. “2017-2020”)
  if (!match) {
    const bareRange = line.match(/\b((?:19|20)\d{2})-((?:19|20)\d{2})\b/);
    if (bareRange) return { start: normalizeDateToken(bareRange[1]), end: normalizeDateToken(bareRange[2]) };
    return { start: '', end: '' };
  }
  return {
    start: normalizeDateToken(match[1]),
    end: normalizeDateToken(match[2] || ''),
  };
}

function normalizeDateToken(token: string) {
  if (!token) return '';
  const clean = token.replace(/\u2013|\u2014/g, '-').trim();
  if (/present|current|now|till\s*date/i.test(clean)) return 'Present';
  return clean;
}

function stripDates(line: string) {
  return line
    .replace(/\b(19\d{2}|20\d{2})[-/]\d{1,2}\b/gi, '')   // YYYY-MM
    .replace(/\b\d{1,2}[/-](19\d{2}|20\d{2})\b/gi, '')   // MM/YYYY
    .replace(/\b(20\d{2}|19\d{2})\b/g, '')                // bare YYYY
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, '')
    .replace(/\b(present|current|now|till\s*date)\b/gi, '')
    .replace(/[-–—â€”â€”|@]\s*$/g, '')
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
  // YYYY-MM format (ISO-style, e.g. "2010-01")
  const yearMonthIso = clean.match(/\b(19\d{2}|20\d{2})[-/](\d{1,2})\b/);
  if (yearMonthIso) {
    return { year: Number(yearMonthIso[1]), month: Math.max(1, Math.min(12, Number(yearMonthIso[2]))) };
  }
  // MM/YYYY or MM-YYYY format
  const monthYearNumeric = clean.match(/\b(\d{1,2})[-/](19\d{2}|20\d{2})\b/);
  if (monthYearNumeric) {
    return { year: Number(monthYearNumeric[2]), month: Math.max(1, Math.min(12, Number(monthYearNumeric[1]))) };
  }
  const year = clean.match(/\b(19\d{2}|20\d{2})\b/);
  if (year) {
    return { year: Number(year[1]), month: end ? 12 : 1 };
  }
  return null;
}



