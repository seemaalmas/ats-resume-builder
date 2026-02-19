import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceSuggestionIndex,
  buildCompanySuggestions,
  persistRecentCompanies,
  readRecentCompanies,
  selectSuggestionAtIndex,
} from '../src/lib/company-suggestions';

class MemoryStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

test('company autosuggest merges local + recent and filters by query', () => {
  const suggestions = buildCompanySuggestions({
    query: 'inf',
    localCompanies: ['Citi Corp', 'Infosys Ltd'],
    recentCompanies: ['One Network Enterprises'],
  });

  assert.ok(suggestions.includes('Infosys Ltd'));
  assert.equal(suggestions.includes('Citi Corp'), false);
});

test('company autosuggest keyboard navigation supports ArrowUp/ArrowDown + Enter selection', () => {
  const suggestions = ['Citi Corp', 'Ernst & Young', 'Infosys Ltd'];
  let index = -1;
  index = advanceSuggestionIndex(index, 'ArrowDown', suggestions.length);
  assert.equal(index, 0);
  index = advanceSuggestionIndex(index, 'ArrowDown', suggestions.length);
  assert.equal(index, 1);
  index = advanceSuggestionIndex(index, 'ArrowUp', suggestions.length);
  assert.equal(index, 0);
  assert.equal(selectSuggestionAtIndex(suggestions, index), 'Citi Corp');
});

test('company autosuggest click-style selection path resolves selected suggestion and stores recents', () => {
  const storage = new MemoryStorage();
  const afterSave = persistRecentCompanies({
    companies: ['Ernst & Young', 'Citi Corp'],
    storage,
  });
  assert.deepEqual(afterSave.slice(0, 2), ['Ernst & Young', 'Citi Corp']);
  const loaded = readRecentCompanies(storage);
  assert.ok(loaded.includes('Ernst & Young'));
  assert.ok(loaded.includes('Citi Corp'));
});
