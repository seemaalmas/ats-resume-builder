import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAutocompleteSuggestions, selectAutocompleteValue } from '../src/components/AutocompleteInput';
import { TECHNICAL_SKILL_FALLBACK } from '../src/lib/suggestion-seeds';
import { addSkillTag } from '../src/lib/skill-tags';

test('institution autocomplete suggestions are filtered and deduped', () => {
  const items = buildAutocompleteSuggestions({
    query: 'iit',
    local: ['IIT Bombay', 'IIT Delhi', 'NIT Trichy'],
    remote: ['IIT Bombay', 'IIT Madras'],
  });

  assert.ok(items.includes('IIT Bombay'));
  assert.ok(items.includes('IIT Delhi'));
  assert.ok(items.includes('IIT Madras'));
  assert.equal(items.includes('NIT Trichy'), false);
});

test('autocomplete selection resolves active option or typed value', () => {
  const suggestions = ['IIT Bombay', 'IIT Delhi', 'IIT Madras'];
  const selectedFromList = selectAutocompleteValue({
    suggestions,
    activeIndex: 1,
    typedValue: 'iit',
  });
  assert.equal(selectedFromList, 'IIT Delhi');

  const selectedFromTyped = selectAutocompleteValue({
    suggestions,
    activeIndex: -1,
    typedValue: 'New Custom Institute',
  });
  assert.equal(selectedFromTyped, 'New Custom Institute');
});

test('technical skills suggestions include broad matches like React and React Native for "rea"', () => {
  const suggestions = buildAutocompleteSuggestions({
    query: 'rea',
    local: TECHNICAL_SKILL_FALLBACK,
    remote: [],
  });
  assert.ok(suggestions.includes('React'));
  assert.ok(suggestions.includes('React Native'));
});

test('selecting an autocomplete suggestion can be applied as a skill tag', () => {
  const suggestions = ['React', 'React Native', 'Redux'];
  const selected = selectAutocompleteValue({
    suggestions,
    activeIndex: 0,
    typedValue: 'rea',
  });
  const next = addSkillTag({ technicalSkills: [], softSkills: [] }, 'technical', selected);
  assert.deepEqual(next.technicalSkills, ['React']);
});
