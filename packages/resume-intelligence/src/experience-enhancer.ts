'use strict';

import { normalizeHeading } from './section-normalizer.js';
import type { ExperienceItem } from 'resume-schemas';
import type { ParsedResumeText } from './resume-parser.js';

const EXPERIENCE_HEADINGS = [
  'professional experience',
  'work experience',
  'experience',
  'employment history',
  'career history',
  'work history',
];
const STOP_HEADINGS = [
  'education',
  'projects',
  'certifications',
  'skills',
  'languages',
  'achievements',
  'summary',
  'additional information',
  'hobbies',
];
const WORK_SECTION_STOP_CANDIDATES = new Set(['skills', 'education', 'projects', 'certifications', 'languages', 'summary']);
const WORK_SECTION_LITERAL_STOPS = new Set(['skills', 'education', 'projects', 'certifications', 'languages', 'hobbies', 'summary']);
const ROLE_HINT_RE = /\b(engineer|developer|manager|architect|consultant|assistant vice president|vice president|avp|director|lead|officer|specialist|principal|administrator|coordinator|analyst|founder|owner|consultant)\b/i;
const COMPANY_HINT_RE = /\b(inc|llc|ltd|corp|company|technologies|systems|solutions|group|partners|bank|consulting|digital|services|labs|enterprises|pvt|private)\b/i;
const DATE_RANGE_RE = /(?:\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*\d{4}|\b\d{1,2}[/-]\d{4}|\b\d{4})(?:\s*(?:-|–|—|to)\s*(?:present|current|now|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*\d{4}|\d{1,2}[/-]\d{4}|\d{4}))?/i;
const BULLET_PREFIX_RE = /^[\-\u2022\u25E6\u25AA\u25CF\*•]\s*/;

type EnhancerInput = {
  rawText: string;
  parsed?: ParsedResumeText;
  currentExperience: ExperienceItem[];
};

export function enhanceExperienceExtraction(input: EnhancerInput): ExperienceItem[] {
  const trimmedCurrent = (input.currentExperience || []).filter((entry) => Boolean(entry));
  if (shouldUseWorkExperienceFallback(trimmedCurrent, input.rawText)) {
    const workExperience = extractExperienceFromWorkExperienceSection(input.rawText, input.parsed);
    if (workExperience.length) return workExperience;
  }

  if (trimmedCurrent.some((entry) => entry.company?.trim() && entry.role?.trim())) {
    return trimmedCurrent;
  }

  const lines = extractExperienceLines(input.rawText, input.parsed);
  const blocks = splitIntoBlocks(lines);
  const candidates = blocks
    .map(parseBlockToExperience)
    .filter((item): item is ExperienceItem => Boolean(item && (item.company || item.role)));

  return candidates.length ? candidates : trimmedCurrent;
}

function extractExperienceLines(rawText: string, parsed?: ParsedResumeText) {
  if (parsed) {
    const sectionLines = [
      ...(parsed.sections.experience || []),
      ...(parsed.sections.employment || []),
      ...(parsed.sections.work || []),
      ...(parsed.sections.career || []),
    ];
    if (sectionLines.length) return sectionLines;
    const startLine = parsed.lines.findIndex((line) => EXPERIENCE_HEADINGS.includes(line.toLowerCase()));
    if (startLine >= 0) {
      const rest = parsed.lines.slice(startLine + 1);
      const endIndex = rest.findIndex((line) => STOP_HEADINGS.includes(line.toLowerCase()));
      if (endIndex >= 0) {
        return rest.slice(0, endIndex);
      }
      if (rest.length) return rest;
    }
  }

  const normalized = normalizeRawText(rawText);
  const allLines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const startIndex = allLines.findIndex((line) => EXPERIENCE_HEADINGS.some((heading) => line.toLowerCase().includes(heading)));
  if (startIndex >= 0) {
    const tail = allLines.slice(startIndex + 1);
    const splitIndex = tail.findIndex((line) => STOP_HEADINGS.some((heading) => line.toLowerCase().includes(heading)));
    if (splitIndex >= 0) return tail.slice(0, splitIndex);
    if (tail.length) return tail;
  }

  return filterLikelyExperienceLines(allLines);
}

function normalizeRawText(text: string) {
  return text
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function filterLikelyExperienceLines(lines: string[]) {
  return lines.filter((line) => {
    if (!line) return false;
    if (DATE_RANGE_RE.test(line)) return true;
    if (line.startsWith('-') && line.length > 2) return true;
    if (ROLE_HINT_RE.test(line) && line.split(' ').length <= 6) return true;
    if (COMPANY_HINT_RE.test(line)) return true;
    return line.length > 80;
  });
}

function splitIntoBlocks(lines: string[]) {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (!line) {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    const lower = line.toLowerCase();
    if (EXPERIENCE_HEADINGS.some((heading) => lower.includes(heading))) {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    if (STOP_HEADINGS.some((heading) => lower.includes(heading))) {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function parseBlockToExperience(block: string[]): ExperienceItem | null {
  if (!block.length) return null;
  let company = '';
  let role = '';
  let startDate = '';
  let endDate = '';
  const highlights: string[] = [];

  for (const line of block) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const date = extractDateRange(trimmed);
    if (date) {
      if (!startDate && date.start) startDate = date.start;
      if (!endDate && date.end) endDate = date.end;
      continue;
    }
    if (BULLET_PREFIX_RE.test(trimmed)) {
      highlights.push(cleanHighlight(trimmed));
      continue;
    }
    if (!role && ROLE_HINT_RE.test(trimmed)) {
      role = trimmed;
      continue;
    }
    if (!company && COMPANY_HINT_RE.test(trimmed)) {
      company = trimmed;
      continue;
    }
  }

  if (!role && block.length) {
    role = block[0];
  }
  if (!company && block.length > 1) {
    const candidate = block.slice(1).find((line) => line && line !== role);
    if (candidate) company = candidate;
  }
  if (!company) {
    const alt = block.find((line) => line.toUpperCase() === line && line.length > 3);
    if (alt) company = alt;
  }

  const entry: ExperienceItem = {
    company: cleanValue(company),
    role: cleanValue(role),
    startDate: startDate.trim(),
    endDate: endDate.trim(),
    highlights: uniqueHighlights(highlights),
  };

  if (!entry.role && !entry.company) return null;
  return entry;
}

function shouldUseWorkExperienceFallback(current: ExperienceItem[], rawText: string) {
  if (!current.length) return true;
  if (current.length === 1 && looksLikeDateFragment(current[0])) return true;
  const rolesWithDates = current.filter((item) => Boolean(String(item.startDate || item.endDate).trim())).length;
  const dateMatches = collectDateRangeMatches(rawText);
  return rolesWithDates <= 1 && dateMatches.length >= 2 && dateMatches.length > rolesWithDates;
}

export function extractExperienceFromWorkExperienceSection(rawText: string, parsed?: ParsedResumeText) {
  if (!rawText && !parsed?.lines?.length) return [];
  const normalizedLines = parsed?.lines?.length
    ? parsed.lines
    : normalizeRawText(rawText).split('\n').map((line) => line.trim()).filter(Boolean);
  if (!normalizedLines.length) return [];
  const startIndex = normalizedLines.findIndex((line) => normalizeHeading(line) === 'experience');
  if (startIndex < 0) return [];
  const blockLines: string[] = [];
  for (let i = startIndex + 1; i < normalizedLines.length; i += 1) {
    const line = normalizedLines[i];
    if (!line.trim()) continue;
    const heading = normalizeHeading(line);
    const literal = line.toLowerCase().replace(/[:\s]+$/g, '');
    const isAchievementsLabel = /achievements?/i.test(literal);
    if (heading && WORK_SECTION_STOP_CANDIDATES.has(heading) && !isAchievementsLabel) {
      break;
    }
    if (WORK_SECTION_LITERAL_STOPS.has(literal)) {
      break;
    }
    blockLines.push(line);
  }
  return parseWorkExperienceBlock(blockLines);
}

function parseWorkExperienceBlock(lines: string[]) {
  const entries: ExperienceItem[] = [];
  let index = 0;
  while (index < lines.length) {
    const currentLine = lines[index].trim();
    if (!currentLine) {
      index += 1;
      continue;
    }
    if (BULLET_PREFIX_RE.test(currentLine)) {
      index += 1;
      continue;
    }
    const inlineHeader = parseInlineCompanyRole(currentLine);
    let entry: ExperienceItem | null = null;
    if (inlineHeader) {
      entry = {
        company: cleanValue(inlineHeader.company),
        role: cleanValue(inlineHeader.role),
        startDate: inlineHeader.startDate,
        endDate: inlineHeader.endDate,
        highlights: [],
      };
      index += 1;
    } else {
      const nextLine = lines[index + 1]?.trim() ?? '';
      if (nextLine && hasDateRange(nextLine)) {
        const parsed = parseCompanyRolePair(currentLine, nextLine);
        entry = {
          company: cleanValue(parsed.company),
          role: cleanValue(parsed.role),
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          highlights: [],
        };
        index += 2;
      } else {
        index += 1;
        continue;
      }
    }

    if (!entry) continue;

    const highlights: string[] = [];
    while (index < lines.length) {
      const highlightLine = lines[index].trim();
      if (!highlightLine) {
        index += 1;
        continue;
      }
      if (shouldBreakForNextJob(highlightLine, lines[index + 1])) {
        break;
      }
      if (/^achievements:?$/i.test(highlightLine)) {
        index += 1;
        continue;
      }
      if (BULLET_PREFIX_RE.test(highlightLine)) {
        highlights.push(cleanHighlight(highlightLine));
      } else if (highlightLine.length > 10) {
        highlights.push(highlightLine);
      }
      index += 1;
    }

    entry.highlights = uniqueHighlights(highlights);
    entries.push(entry);
  }
  return entries;
}

function parseCompanyRolePair(companyLine: string, roleLine: string) {
  const match = matchDateRangeSegment(roleLine);
  const startDate = match?.start || '';
  const endDate = match?.end || '';
  const removedDates = match ? roleLine.replace(match.segment, '') : roleLine;
  return {
    company: companyLine,
    role: cleanRoleText(removedDates),
    startDate,
    endDate,
  };
}

function parseInlineCompanyRole(line: string) {
  const match = matchDateRangeSegment(line);
  if (!match) return null;
  const cleaned = line.replace(match.segment, '').trim();
  const delimiters = ['—', '–', ' - ', ' | ', ' – ', ' — ', '|'];
  for (const delimiter of delimiters) {
    if (cleaned.includes(delimiter)) {
      const parts = cleaned.split(delimiter).map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return {
          company: parts[0],
          role: parts.slice(1).join(` ${delimiter.trim()} `).trim(),
          startDate: match.start,
          endDate: match.end,
        };
      }
    }
  }
  return null;
}

function shouldBreakForNextJob(line: string, nextLine?: string) {
  if (!line) return false;
  if (/^achievements:?$/i.test(line)) return false;
  if (parseInlineCompanyRole(line)) return true;
  if (nextLine && hasDateRange(nextLine) && looksLikeCompanyLine(line)) return true;
  return false;
}

function cleanRoleText(value: string) {
  return value
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[-–—|@]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function looksLikeCompanyLine(line: string) {
  const trimmed = line.replace(/[,:]/g, '').trim();
  if (!trimmed || trimmed.length > 80) return false;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const titleCased = tokens.filter((word) => /^[A-Z][A-Za-z0-9&'()./-]*$/.test(word) || /^[A-Z]{2,}$/.test(word));
  if (titleCased.length >= Math.ceil(tokens.length / 2)) return true;
  if (/(inc|llc|ltd|corp|company|technologies|systems|solutions|group|partners|bank|consulting|enterprises|services|labs|digital|pvt|limited|infotech)/i.test(trimmed)) {
    return true;
  }
  return false;
}

function hasDateRange(line: string) {
  return Boolean(matchDateRangeSegment(line));
}

function matchDateRangeSegment(line: string) {
  const match = line.match(DATE_RANGE_RE);
  if (!match) return null;
  const segment = match[0];
  const [startToken, ...rest] = segment.split(/(?:-|to|–|—)/i);
  const start = (startToken || '').trim();
  const endCandidate = rest.join(' ').trim();
  const end = endCandidate && /present|current|now/i.test(endCandidate) ? 'Present' : endCandidate;
  return { segment, start, end };
}

function collectDateRangeMatches(text: string) {
  if (!text) return [];
  const matcher = new RegExp(DATE_RANGE_RE.source, 'gi');
  const matches = Array.from(String(text).matchAll(matcher))
    .map((match) => String(match[0] || '').trim())
    .filter(Boolean);
  return Array.from(new Set(matches));
}

function looksLikeDateFragment(entry: ExperienceItem) {
  const company = String(entry.company || '').trim();
  const role = String(entry.role || '').trim();
  if (!company && !role) return true;
  const combined = `${company} ${role}`.trim();
  if (/^\(?\d/.test(combined)) return true;
  if (/[0-9]{4}[-/)]/.test(combined)) return true;
  if (/07\)/.test(combined)) return true;
  return false;
}

function extractDateRange(line: string) {
  const match = line.match(DATE_RANGE_RE);
  if (!match) return null;
  const start = match[0].split(/-|\s+to\s+|–|—/i)[0].trim();
  const remaining = match[0].slice(match[0].indexOf(start) + start.length);
  const endMatch = remaining.match(/(?:-|–|—|\s+to\s+)\s*(.+)/i);
  const end = endMatch ? endMatch[1].trim() : '';
  return { start, end };
}

function cleanHighlight(line: string) {
  return line.replace(BULLET_PREFIX_RE, '').trim();
}

function cleanValue(value: string) {
  return value.replace(/[|•\*]/g, ' ').trim();
}

function uniqueHighlights(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean) continue;
    if (seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    output.push(clean);
  }
  return output;
}
