import { dedupeLanguages, splitLanguagesFromSkills } from './languages';

export type SkillCategory = 'technical' | 'soft';

export function dedupeSkillTags(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values || []) {
    const clean = String(value || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

export function normalizeSkillCategories(input: {
  skills?: string[];
  technicalSkills?: string[];
  softSkills?: string[];
  languages?: string[];
}) {
  return splitLanguagesFromSkills({
    skills: input.skills || [],
    technicalSkills: input.technicalSkills || [],
    softSkills: input.softSkills || [],
    languages: input.languages || [],
  });
}

export function addSkillTag(categories: {
  technicalSkills: string[];
  softSkills: string[];
}, category: SkillCategory, value: string) {
  const clean = String(value || '').trim();
  if (!clean) return categories;
  return {
    technicalSkills: category === 'technical'
      ? dedupeSkillTags([...categories.technicalSkills, clean])
      : dedupeSkillTags(categories.technicalSkills),
    softSkills: category === 'soft'
      ? dedupeSkillTags([...categories.softSkills, clean])
      : dedupeSkillTags(categories.softSkills),
  };
}

export function removeSkillTag(categories: {
  technicalSkills: string[];
  softSkills: string[];
}, category: SkillCategory, value: string) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return categories;
  return {
    technicalSkills: category === 'technical'
      ? categories.technicalSkills.filter((item) => item.trim().toLowerCase() !== key)
      : categories.technicalSkills,
    softSkills: category === 'soft'
      ? categories.softSkills.filter((item) => item.trim().toLowerCase() !== key)
      : categories.softSkills,
  };
}

export function addLanguageTag(languages: string[], value: string) {
  return dedupeLanguages([...(languages || []), value]);
}

export function removeLanguageTag(languages: string[], value: string) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return dedupeLanguages(languages || []);
  return dedupeLanguages((languages || []).filter((item) => item.trim().toLowerCase() !== key));
}
