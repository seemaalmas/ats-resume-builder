import assert from 'node:assert/strict';
import test from 'node:test';
import { addEmptyProject, ensureAtLeastOneProject, isValidProjectUrl, moveProject } from '../src/lib/project-editor';
import type { ResumeDraft } from '../src/lib/resume-store';

function baseResume(): ResumeDraft {
  return {
    title: 'Resume',
    contact: { fullName: 'User' },
    summary: 'Summary with enough detail for validation.',
    skills: ['React', 'Node.js', 'TypeScript'],
    technicalSkills: ['React', 'Node.js', 'TypeScript'],
    softSkills: [],
    experience: [],
    education: [],
    projects: [],
    certifications: [],
  };
}

test('add new project creates a blank entry with no prefilled details', () => {
  const updated = addEmptyProject(baseResume());
  assert.equal(updated.projects.length, 1);
  assert.deepEqual(updated.projects[0], {
    name: '',
    role: '',
    startDate: '',
    endDate: '',
    url: '',
    highlights: [],
  });
});

test('enabling projects section starts with exactly one blank project form', () => {
  const initial = baseResume();
  const firstVisible = ensureAtLeastOneProject(initial.projects);
  assert.equal(firstVisible.length, 1);
  assert.deepEqual(firstVisible[0], {
    name: '',
    role: '',
    startDate: '',
    endDate: '',
    url: '',
    highlights: [],
  });

  const withSecond = addEmptyProject({ ...initial, projects: firstVisible });
  assert.equal(withSecond.projects.length, 2);
  assert.equal(withSecond.projects[0].name, '');
  assert.equal(withSecond.projects[1].name, '');
});

test('project move keeps incremental order stable', () => {
  const seed = baseResume();
  seed.projects = [
    { name: 'A', role: '', startDate: '', endDate: '', url: '', highlights: [] },
    { name: 'B', role: '', startDate: '', endDate: '', url: '', highlights: [] },
    { name: 'C', role: '', startDate: '', endDate: '', url: '', highlights: [] },
  ];
  const movedDown = moveProject(seed, 0, 1);
  assert.deepEqual(movedDown.projects.map((item) => item.name), ['B', 'A', 'C']);
  const movedUp = moveProject(movedDown, 2, -1);
  assert.deepEqual(movedUp.projects.map((item) => item.name), ['B', 'C', 'A']);
});

test('project URL validation rejects invalid URL and accepts GitHub/Bitbucket/https URLs', () => {
  assert.equal(isValidProjectUrl(''), true);
  assert.equal(isValidProjectUrl('http://github.com/user/repo'), false);
  assert.equal(isValidProjectUrl('notaurl'), false);
  assert.equal(isValidProjectUrl('https://github.com/user/repo'), true);
  assert.equal(isValidProjectUrl('https://bitbucket.org/team/repo'), true);
  assert.equal(isValidProjectUrl('https://example.com/project'), true);
});
