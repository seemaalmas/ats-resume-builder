import assert from 'node:assert/strict';
import test from 'node:test';
import { addEmptyExperience } from '../src/lib/experience-editor';
import { toYearMonth } from '../src/lib/date-utils';
import { validateExperienceEntries } from '../src/lib/experience-validation';
import type { ResumeDraft } from '../src/lib/resume-store';

function baseResume(): ResumeDraft {
  return {
    title: 'Imported Resume',
    contact: { fullName: 'Chandan Kumar', email: 'cks011992@gmail.com' },
    summary: 'Engineering leader with enterprise delivery experience.',
    skills: ['React', 'Node.js', 'TypeScript'],
    experience: [
      {
        company: 'Citi Corp',
        role: 'AVP',
        startDate: '2022-12',
        endDate: 'Present',
        highlights: ['Led platform modernization improving performance by 35%.'],
      },
    ],
    education: [
      {
        institution: 'Siddaganga Institute',
        degree: 'B.E Telecommunication',
        startDate: '2010-01',
        endDate: '2014-06',
        details: ['Graduated with strong academic foundation.'],
      },
    ],
    projects: [],
    certifications: [],
  };
}

test('experience add action appends new block at the bottom of the list', () => {
  const seed = baseResume();
  seed.experience.push({
    company: 'Ernst & Young',
    role: 'Senior Technology Consultant',
    startDate: '2021-10',
    endDate: '2022-12',
    highlights: ['Built reusable templates reducing setup time by 60%.'],
  });

  const next = addEmptyExperience(seed);
  assert.equal(next.experience.length, 3);
  assert.equal(next.experience[2].company, '');
  assert.equal(next.experience[2].role, '');
});

test('date picker normalization emits YYYY-MM and accepts Present', () => {
  assert.equal(toYearMonth('Dec 2022'), '2022-12');
  assert.equal(toYearMonth('10/2021'), '2021-10');
  assert.equal(toYearMonth('Present'), 'Present');
});

test('experience validation blocks save when dates are invalid', () => {
  const valid = validateExperienceEntries(baseResume().experience);
  assert.equal(valid.hasErrors, false);
  assert.equal(valid.hasErrors, false, 'Save button should stay enabled when experience is valid.');

  const invalid = baseResume();
  invalid.experience[0].startDate = '2024-05';
  invalid.experience[0].endDate = '2023-11';
  const invalidResult = validateExperienceEntries(invalid.experience);
  assert.equal(invalidResult.hasErrors, true);
  assert.equal(invalidResult.entries[0].endDate, 'End date must be after start date.');
  assert.equal(invalidResult.hasErrors, true, 'Save button should be disabled for invalid experience dates.');
});
