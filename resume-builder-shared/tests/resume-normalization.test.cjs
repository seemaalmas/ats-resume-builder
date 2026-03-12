const assert = require('node:assert/strict');
const test = require('node:test');

const sharedPromise = import('../dist/index.js');

test('normalizeExperienceOrder sorts present first and newest to oldest', async () => {
  const { normalizeResumeForAts } = await sharedPromise;
  const normalized = normalizeResumeForAts({
    summary: 'Delivery-focused engineer.',
    skills: ['TypeScript', 'Node.js', 'Leadership'],
    experience: [
      { company: 'Old Co', role: 'Engineer', startDate: '2018-01', endDate: '2020-01', highlights: ['Built reporting modules.'] },
      { company: 'Current Co', role: 'Lead Engineer', startDate: '2024-03', endDate: 'Present', highlights: ['Led platform modernization.'] },
      { company: 'Recent Co', role: 'Senior Engineer', startDate: '2021-06', endDate: '2024-02', highlights: ['Improved release stability.'] },
    ],
    education: [{ institution: 'State University', degree: 'B.E', startDate: '2014-06', endDate: '2018-05', details: [] }],
  });

  assert.equal(normalized.experience[0].company, 'Current Co');
  assert.equal(normalized.experience[1].company, 'Recent Co');
  assert.equal(normalized.experience[2].company, 'Old Co');
});

test('normalizeDates and formatDateForDisplay use YYYY-MM internally and MMM YYYY for render', async () => {
  const { normalizeResumeForAts, formatDateForDisplay, formatDateRange } = await sharedPromise;
  const normalized = normalizeResumeForAts({
    summary: 'Systems engineer.',
    skills: ['AWS', 'Python', 'Kubernetes'],
    experience: [
      {
        company: 'Acme',
        role: 'Engineer',
        startDate: 'Dec 2022',
        endDate: 'Present',
        highlights: ['Delivered reliability improvements.'],
      },
    ],
    education: [{ institution: 'College', degree: 'B.Tech', startDate: '2016', endDate: '2020', details: [] }],
  });

  assert.equal(normalized.experience[0].startDate, '2022-12');
  assert.equal(normalized.experience[0].endDate, 'Present');
  assert.equal(formatDateForDisplay('2022-12'), 'Dec 2022');
  assert.equal(formatDateRange('2022-12', 'Present'), 'Dec 2022 - Present');
  assert.equal(formatDateRange('---------, ----', ''), '');
});

test('normalizeSections returns ATS section order and canonical titles', async () => {
  const { getAtsSectionOrder, getAtsSectionTitle } = await sharedPromise;
  const order = getAtsSectionOrder({
    summary: 'Platform engineer.',
    skills: ['TypeScript', 'React', 'Node.js'],
    experience: [{ company: 'Acme', role: 'Engineer', startDate: '2022-01', endDate: 'Present', highlights: ['Built resilient APIs.'] }],
    education: [{ institution: 'State University', degree: 'B.E', startDate: '2016-01', endDate: '2020-01', details: [] }],
    projects: [],
    certifications: [],
    languages: [],
  });

  assert.deepEqual(order, ['header', 'summary', 'skills', 'experience', 'education']);
  assert.equal(getAtsSectionTitle('summary'), 'Summary');
  assert.equal(getAtsSectionTitle('skills'), 'Skills');
  assert.equal(getAtsSectionTitle('experience'), 'Experience');
});

test('sanitizeBullets removes legacy prefixes, duplicate leading labels, and orphan separators', async () => {
  const { sanitizeBullets } = await sharedPromise;
  const normalized = sanitizeBullets({
    experience: [
      {
        company: 'Acme',
        role: 'Engineer',
        startDate: '2022-01',
        endDate: 'Present',
        highlights: [
          'Impact: Impact: Led cross-functional delivery  ',
          '-  Achievement:  Improved deployment speed by 40% - ',
          '* Result: Reduced incident count by 32%  ',
        ],
      },
    ],
    projects: [],
    education: [],
    certifications: [],
  });

  assert.deepEqual(normalized.experience[0].highlights, [
    'Led cross-functional delivery',
    'Improved deployment speed by 40%',
    'Reduced incident count by 32%',
  ]);
});
