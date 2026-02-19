import assert from 'node:assert/strict';
import test from 'node:test';
import { addLanguageTag, addSkillTag, normalizeSkillCategories, removeLanguageTag, removeSkillTag } from '../src/lib/skill-tags';

test('skills categories normalize with legacy compatibility', () => {
  const normalized = normalizeSkillCategories({
    skills: ['React', 'Node.js'],
    technicalSkills: [],
    softSkills: ['Communication'],
    languages: [],
  });

  assert.deepEqual(normalized.technicalSkills, ['React', 'Node.js']);
  assert.deepEqual(normalized.softSkills, ['Communication']);
  assert.deepEqual(normalized.languages, []);
  assert.deepEqual(normalized.skills, ['React', 'Node.js', 'Communication']);
});

test('skills chips add/remove keeps categories in sync', () => {
  const initial = {
    technicalSkills: ['React'],
    softSkills: ['Leadership'],
  };
  const afterAdd = addSkillTag(initial, 'technical', 'TypeScript');
  assert.deepEqual(afterAdd.technicalSkills, ['React', 'TypeScript']);
  assert.deepEqual(afterAdd.softSkills, ['Leadership']);

  const afterRemove = removeSkillTag(afterAdd, 'technical', 'react');
  assert.deepEqual(afterRemove.technicalSkills, ['TypeScript']);
  assert.deepEqual(afterRemove.softSkills, ['Leadership']);
});

test('known spoken languages are moved out of technical skills into languages', () => {
  const normalized = normalizeSkillCategories({
    skills: ['React', 'English', 'Hindi'],
    technicalSkills: ['React', 'English', 'Hindi'],
    softSkills: ['Leadership'],
    languages: [],
  });

  assert.deepEqual(normalized.technicalSkills, ['React']);
  assert.deepEqual(normalized.languages, ['English', 'Hindi']);
  assert.equal(normalized.skills.includes('English'), false);
  assert.equal(normalized.skills.includes('Hindi'), false);
});

test('language chips can be added and removed independently', () => {
  const withLanguage = addLanguageTag([], 'English');
  assert.deepEqual(withLanguage, ['English']);

  const withSecondLanguage = addLanguageTag(withLanguage, 'Hindi');
  assert.deepEqual(withSecondLanguage, ['English', 'Hindi']);

  const afterRemove = removeLanguageTag(withSecondLanguage, 'english');
  assert.deepEqual(afterRemove, ['Hindi']);
});
