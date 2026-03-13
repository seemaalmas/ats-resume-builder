export type CanonicalSection =
  | 'summary'
  | 'skills'
  | 'experience'
  | 'education'
  | 'projects'
  | 'certifications'
  | 'unmapped';

const SECTION_SYNONYMS: Record<CanonicalSection, string[]> = {
  summary: ['summary', 'professional summary', 'profile', 'about', 'about me', 'objective', 'career summary'],
  skills: [
    'skills',
    'technical skills',
    'core skills',
    'key skills',
    'competencies',
    'core competencies',
    'technologies',
    'soft skills',
    'languages',
  ],
  experience: [
    'experience',
    'work experience',
    'work history',
    'employment',
    'employment history',
    'professional experience',
    'career history',
  ],
  education: ['education', 'academics', 'academic background', 'education history'],
  projects: ['projects', 'notable projects', 'research', 'achievements'],
  certifications: ['certifications', 'licenses', 'certificates'],
  unmapped: [],
};

export function normalizeHeading(line: string): CanonicalSection | '' {
  const pageFooterHeading = line.match(/--\s*\d+\s*of\s*\d+\s*--\s*([a-z][a-z\s]+)$/i);
  if (pageFooterHeading && pageFooterHeading[1]) {
    const nested = normalizeHeading(pageFooterHeading[1]);
    if (nested) return nested;
  }

  const normalized = line
    .toLowerCase()
    .replace(/--\s*\d+\s*of\s*\d+\s*--/g, ' ')
    .replace(/[:\s]+$/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (!isHeadingLike(line, normalized)) return '';
  for (const [section, synonyms] of Object.entries(SECTION_SYNONYMS)) {
    if (synonyms.includes(normalized)) return section as CanonicalSection;
  }
  return /:\s*$/.test(line) ? 'unmapped' : '';
}

const KNOWN_HEADING_PHRASES = new Set([
  'professional summary',
  'work experience',
  'technical skills',
  'soft skills',
  'education',
  'achievements',
  'languages',
  'summary',
  'skills',
  'experience',
  'projects',
  'certifications',
  'certificates',
  'employment',
  'employment history',
  'career history',
  'career summary',
  'profile',
  'about',
  'about me',
  'objective',
  'core competencies',
  'competencies',
  'technologies',
  'academics',
  'academic background',
  'notable projects',
  'research',
  'work history',
  'core skills',
  'key skills',
  'licenses',
  'education history',
]);

function isHeadingLike(rawLine: string, normalized: string) {
  const raw = String(rawLine || '').trim();
  if (!raw || raw.length > 64) return false;
  if (/^[\-*•·]/.test(raw)) return false;
  if (/[.,;!?]/.test(raw) && !/:\s*$/.test(raw)) return false;
  if (/\d{2,}/.test(raw) && !/--\s*\d+\s*of\s*\d+\s*--/.test(raw)) return false;
  if (/:\s*$/.test(raw)) return true;

  // Check known heading phrases BEFORE rejecting lowercase-only lines
  if (KNOWN_HEADING_PHRASES.has(normalized)) return true;

  if (/^[a-z\s]+$/.test(raw)) return false;

  const words = raw.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const headingWords = words.filter((word) => /^[A-Z][A-Za-z0-9&'()./-]*$/.test(word) || /^[A-Z]{2,}$/.test(word));
  if (headingWords.length >= Math.ceil(words.length * 0.6)) return true;

  return false;
}
