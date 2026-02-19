export const LANGUAGE_SUGGESTIONS = [
  'English',
  'Hindi',
  'Urdu',
  'Bengali',
  'Marathi',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Gujarati',
  'Punjabi',
  'Odia',
  'Assamese',
  'Sanskrit',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Japanese',
  'Mandarin',
  'Chinese',
  'Korean',
  'Arabic',
  'Russian',
];

const LANGUAGE_LOOKUP = new Map<string, string>(
  LANGUAGE_SUGGESTIONS.map((item) => [item.toLowerCase(), item]),
);

export function normalizeLanguageTag(value: string) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  const normalized = clean
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [token, canonical] of LANGUAGE_LOOKUP.entries()) {
    const regex = new RegExp(`^${escapeRegExp(token)}(?:\\b|\\s|-)`, 'i');
    if (regex.test(normalized)) {
      return canonical;
    }
  }
  return clean;
}

export function isKnownLanguageTag(value: string) {
  const normalized = normalizeLanguageTag(value);
  if (!normalized) return false;
  return LANGUAGE_LOOKUP.has(normalized.toLowerCase());
}

export function dedupeLanguages(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values || []) {
    const normalized = normalizeLanguageTag(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

export function splitLanguagesFromSkills(input: {
  skills?: string[];
  technicalSkills?: string[];
  softSkills?: string[];
  languages?: string[];
}) {
  const legacySkills = dedupeValues(input.skills || []);
  const technicalSeed = dedupeValues(
    (input.technicalSkills && input.technicalSkills.length)
      ? input.technicalSkills
      : legacySkills,
  );
  const softSkills = dedupeValues(input.softSkills || []);
  const explicitLanguages = dedupeLanguages(input.languages || []);

  const migratedFromTechnical = technicalSeed.filter((item) => isKnownLanguageTag(item)).map((item) => normalizeLanguageTag(item));
  const migratedFromLegacy = legacySkills.filter((item) => isKnownLanguageTag(item)).map((item) => normalizeLanguageTag(item));
  const languages = dedupeLanguages([...explicitLanguages, ...migratedFromTechnical, ...migratedFromLegacy]);

  const technicalSkills = technicalSeed.filter((item) => !isKnownLanguageTag(item));
  const legacyWithoutLanguages = legacySkills.filter((item) => !isKnownLanguageTag(item));
  const skills = dedupeValues([...technicalSkills, ...softSkills, ...legacyWithoutLanguages]);

  return {
    skills,
    technicalSkills,
    softSkills,
    languages,
  };
}

function dedupeValues(values: string[]) {
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
