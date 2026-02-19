import technicalSeed from '@/src/data/skills_technical_seed.json';
import softSeed from '@/src/data/skills_soft_seed.json';
import certificationSeed from '@/src/data/certifications_seed.json';

type SeedFile = {
  _note?: string;
  items?: string[];
};

export const EDUCATION_INSTITUTION_FALLBACK = [
  'Indian Institute of Technology Bombay',
  'Indian Institute of Technology Delhi',
  'Indian Institute of Technology Madras',
  'Indian Institute of Technology Kanpur',
  'Indian Institute of Technology Kharagpur',
  'Indian Institute of Science Bengaluru',
  'BITS Pilani',
  'IIIT Hyderabad',
  'IIIT Bangalore',
  'National Institute of Technology Tiruchirappalli',
  'National Institute of Technology Surathkal',
  'Delhi Technological University',
  'Vellore Institute of Technology',
  'SRM Institute of Science and Technology',
  'Savitribai Phule Pune University',
  'University of Delhi',
  'Anna University',
  'Jadavpur University',
  'Manipal Institute of Technology',
  'Thapar Institute of Engineering and Technology',
];

export const SKILL_CATEGORY_HINTS = [
  'Languages',
  'Frontend',
  'Backend',
  'Cloud',
  'DevOps',
  'Data',
  'Testing',
  'Mobile',
  'Security',
  'Tools',
];

export const TECHNICAL_SKILL_FALLBACK = dedupe((technicalSeed as SeedFile).items || []);

export const SOFT_SKILL_FALLBACK = dedupe((softSeed as SeedFile).items || []);

export const CERTIFICATION_FALLBACK = dedupe((certificationSeed as SeedFile).items || []);

function dedupe(items: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items || []) {
    const clean = String(item || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}
