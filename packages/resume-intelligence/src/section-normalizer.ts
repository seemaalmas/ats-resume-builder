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
  skills: ['skills', 'technical skills', 'core skills', 'key skills', 'competencies', 'core competencies', 'technologies'],
  experience: ['experience', 'work experience', 'employment history', 'employment', 'work history', 'professional experience', 'career history'],
  education: ['education', 'academics', 'academic background', 'education history'],
  projects: ['projects', 'notable projects', 'research'],
  certifications: ['certifications', 'licenses', 'certificates'],
  unmapped: [],
};

export function normalizeHeading(line: string): CanonicalSection | '' {
  const normalized = line
    .toLowerCase()
    .replace(/[:\s]+$/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  for (const [section, synonyms] of Object.entries(SECTION_SYNONYMS)) {
    if (synonyms.includes(normalized)) return section as CanonicalSection;
  }
  return line.endsWith(':') ? 'unmapped' : '';
}
