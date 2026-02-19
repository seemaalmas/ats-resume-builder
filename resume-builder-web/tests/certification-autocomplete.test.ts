import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAutocompleteSuggestions, selectAutocompleteValue } from '../src/components/AutocompleteInput';
import { CERTIFICATION_FALLBACK } from '../src/lib/suggestion-seeds';

test('certification autocomplete suggests Azure certifications', () => {
  const suggestions = buildAutocompleteSuggestions({
    query: 'azure',
    local: CERTIFICATION_FALLBACK,
    remote: [],
  });
  const normalized = suggestions.map((item) => item.toLowerCase());
  assert.ok(normalized.some((item) => item.includes('az-900')));
  assert.ok(normalized.some((item) => item.includes('az-104')));
});

test('certification autocomplete allows custom values when no suggestion matches', () => {
  const selected = selectAutocompleteValue({
    suggestions: [],
    activeIndex: -1,
    typedValue: 'My Custom Enterprise Credential',
    allowCustom: true,
  });
  assert.equal(selected, 'My Custom Enterprise Credential');
});
