import assert from 'node:assert/strict';
import test from 'node:test';
import { addEmptyExperience, removeExperienceAt } from '../src/lib/experience-editor';
import type { ResumeDraft } from '../src/lib/resume-store';

function sampleResume(): ResumeDraft {
  return {
    title: 'Imported Resume',
    contact: { fullName: 'Chandan Kumar' },
    summary: 'Tech lead with enterprise frontend/backend experience.',
    skills: ['React', 'Node.js'],
    experience: [
      { company: 'Citi Corp', role: 'AVP', startDate: 'Dec 2022', endDate: 'Present', highlights: ['Led platform work'] },
    ],
    education: [],
    projects: [],
    certifications: [],
  };
}

test('/resume/review add new experience appends an empty editable block', () => {
  const next = addEmptyExperience(sampleResume());
  assert.equal(next.experience.length, 2);
  assert.equal(next.experience[1].company, '');
  assert.equal(next.experience[1].role, '');
  assert.deepEqual(next.experience[1].highlights, ['']);
});

test('/resume/review remove experience keeps editor editable with at least one block', () => {
  const removed = removeExperienceAt(sampleResume(), 0);
  assert.equal(removed.experience.length, 1);
  assert.equal(removed.experience[0].company, '');
  assert.equal(removed.experience[0].role, '');
});
