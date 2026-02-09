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
  return text
    .replace(/\u0000/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/â€¢|â—¦|â–ª|â—/g, '- ')
    .replace(/[\u2022\u25e6\u25aa\u25cf\u00b7]/g, '- ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

