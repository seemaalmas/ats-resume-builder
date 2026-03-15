import type { CanonicalSection } from './section-normalizer.js';
import { normalizeHeading } from './section-normalizer.js';

export type ParsedResumeText = {
  lines: string[];
  sections: Record<string, string[]>;
};

export function parseResumeText(rawText: string): ParsedResumeText {
  const text = normalizeText(rawText);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const sections: Record<string, string[]> = {};
  let current: CanonicalSection | string = 'unmapped';

  for (const line of lines) {
    const heading = normalizeHeading(line);
    if (heading) {
      current = heading;
      if (!sections[current]) sections[current] = [];
      continue;
    }
    if (!sections[current]) sections[current] = [];
    sections[current].push(line);
  }

  return { lines, sections };
}

export function normalizeText(text: string) {
  const canonical = text
    .replace(/\u0000/g, '')
    // Normalize Unicode ligatures commonly mangled by pdf-parse:
    // ﬃ→ffi, ﬄ→ffl, ﬀ→ff, ﬁ→fi, ﬂ→fl (order matters: longest first)
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/â€¢|â—¦|â–ª|â—/g, '- ')
    .replace(/[\u2022\u25e6\u25aa\u25cf\u00b7]/g, '- ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => normalizeLegacyBulletPrefix(line))
    .join('\n');

  return canonical
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const LEGACY_BULLET_PREFIX_RE = /^\s*(?:[-*•·]+|\d{1,3}[.)]|[a-z][.)])?\s*(impact|achievement|result|highlights?|accomplishment)s?:\s*/i;

function normalizeLegacyBulletPrefix(line: string) {
  const raw = String(line || '');
  if (!LEGACY_BULLET_PREFIX_RE.test(raw)) return raw;
  const stripped = raw.replace(LEGACY_BULLET_PREFIX_RE, '').trim();
  if (!stripped) return '';
  // Preserve bullet semantics so highlights continue to attach to the active role.
  return `- ${stripped}`;
}

