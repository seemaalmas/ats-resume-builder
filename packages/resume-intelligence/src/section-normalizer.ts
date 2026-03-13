export type CanonicalSection =
  | 'summary'
  | 'skills'
  | 'experience'
  | 'education'
  | 'projects'
  | 'certifications'
  | 'unmapped';

const SECTION_SYNONYMS: Record<CanonicalSection, string[]> = {
  summary: ['summary', 'professional summary', 'profile', 'profile summary', 'about', 'about me', 'objective', 'career summary', 'career objective', 'executive summary', 'personal statement', 'introduction'],
  skills: [
    'skills',
    'technical skills',
    'core skills',
    'key skills',
    'key skill',
    'competencies',
    'core competencies',
    'technologies',
    'soft skills',
    'languages',
    'tools and technologies',
    'technical competencies',
    'areas of expertise',
    'expertise',
    'technical proficiencies',
    'proficiencies',
  ],
  experience: [
    'experience',
    'work experience',
    'work history',
    'employment',
    'employment history',
    'professional experience',
    'career history',
    'professional background',
    'relevant experience',
    'industry experience',
  ],
  education: ['education', 'academics', 'academic background', 'education history', 'qualifications', 'educational qualifications', 'academic qualifications', 'academic details'],
  projects: ['projects', 'notable projects', 'research', 'achievements', 'accomplishments', 'key projects', 'project experience', 'key achievements'],
  certifications: ['certifications', 'licenses', 'certificates', 'professional certifications', 'training', 'training and certifications', 'courses'],
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
  'profile summary',
  'career summary',
  'career objective',
  'executive summary',
  'personal statement',
  'introduction',
  'work experience',
  'professional experience',
  'professional background',
  'relevant experience',
  'industry experience',
  'technical skills',
  'soft skills',
  'tools and technologies',
  'technical competencies',
  'areas of expertise',
  'expertise',
  'technical proficiencies',
  'proficiencies',
  'education',
  'educational qualifications',
  'academic qualifications',
  'academic details',
  'achievements',
  'accomplishments',
  'key achievements',
  'languages',
  'summary',
  'skills',
  'experience',
  'projects',
  'key projects',
  'project experience',
  'certifications',
  'certificates',
  'professional certifications',
  'training',
  'training and certifications',
  'courses',
  'employment',
  'employment history',
  'career history',
  'profile',
  'about',
  'about me',
  'objective',
  'core competencies',
  'competencies',
  'technologies',
  'academics',
  'academic background',
  'qualifications',
  'notable projects',
  'research',
  'work history',
  'core skills',
  'key skills',
  'key skill',
  'licenses',
  'education history',
]);

function isHeadingLike(rawLine: string, normalized: string) {
  const raw = String(rawLine || '').trim();
  if (!raw || raw.length > 80) return false;
  if (/^[\-*•·]/.test(raw)) return false;
  if (/[.,;!?]/.test(raw) && !/:\s*$/.test(raw)) return false;
  if (/\d{2,}/.test(raw) && !/--\s*\d+\s*of\s*\d+\s*--/.test(raw)) return false;
  if (/:\s*$/.test(raw)) return true;

  // Check known heading phrases BEFORE rejecting lowercase-only lines
  if (KNOWN_HEADING_PHRASES.has(normalized)) return true;

  // ALL CAPS lines that match a known pattern are headings
  if (/^[A-Z\s&/]+$/.test(raw) && raw.length <= 40 && KNOWN_HEADING_PHRASES.has(normalized)) return true;

  if (/^[a-z\s]+$/.test(raw)) return false;

  const words = raw.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const headingWords = words.filter((word) => /^[A-Z][A-Za-z0-9&'()./-]*$/.test(word) || /^[A-Z]{2,}$/.test(word));
  if (headingWords.length >= Math.ceil(words.length * 0.6)) return true;

  return false;
}
