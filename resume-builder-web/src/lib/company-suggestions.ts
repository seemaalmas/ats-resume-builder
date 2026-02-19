type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const RECENT_COMPANIES_STORAGE_KEY = 'resume-builder.recent-companies.v1';
const MAX_RECENT_COMPANIES = 24;

export function normalizeCompanyName(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function dedupeCompanyNames(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeCompanyName(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

export function mergeCompanyPools(...groups: string[][]) {
  return dedupeCompanyNames(groups.flat());
}

export function buildCompanySuggestions(input: {
  query: string;
  localCompanies?: string[];
  recentCompanies?: string[];
  remoteCompanies?: string[];
  limit?: number;
}) {
  const query = normalizeCompanyName(input.query).toLowerCase();
  const merged = mergeCompanyPools(
    input.localCompanies || [],
    input.recentCompanies || [],
    input.remoteCompanies || [],
  );
  const ranked = merged
    .filter((name) => {
      if (!query) return true;
      return name.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (!query) return a.localeCompare(b);
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aStarts = aLower.startsWith(query);
      const bStarts = bLower.startsWith(query);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.localeCompare(b);
    });
  return ranked.slice(0, input.limit || 8);
}

export function advanceSuggestionIndex(
  currentIndex: number,
  direction: 'ArrowDown' | 'ArrowUp',
  itemCount: number,
) {
  if (itemCount <= 0) return -1;
  if (direction === 'ArrowDown') {
    if (currentIndex < 0) return 0;
    return (currentIndex + 1) % itemCount;
  }
  if (currentIndex < 0) return itemCount - 1;
  return (currentIndex - 1 + itemCount) % itemCount;
}

export function selectSuggestionAtIndex(suggestions: string[], index: number) {
  if (index < 0 || index >= suggestions.length) return '';
  return suggestions[index] || '';
}

export function readRecentCompanies(storage?: StorageLike) {
  const target = resolveStorage(storage);
  if (!target) return [];
  const raw = target.getItem(RECENT_COMPANIES_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupeCompanyNames(parsed.map((item) => String(item || '')));
  } catch {
    return [];
  }
}

export function persistRecentCompanies(
  input: { companies: string[]; storage?: StorageLike; limit?: number },
) {
  const target = resolveStorage(input.storage);
  const existing = readRecentCompanies(target || undefined);
  const merged = dedupeCompanyNames([...input.companies, ...existing])
    .slice(0, input.limit || MAX_RECENT_COMPANIES);
  if (target) {
    target.setItem(RECENT_COMPANIES_STORAGE_KEY, JSON.stringify(merged));
  }
  return merged;
}

function resolveStorage(storage?: StorageLike) {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}
