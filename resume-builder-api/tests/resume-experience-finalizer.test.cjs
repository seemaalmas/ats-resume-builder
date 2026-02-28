const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  extractExperienceFromText,
  finalizeExperience,
} = require('../dist/resume/resume.service.js');

const fixturePath = path.resolve(__dirname, 'fixtures', 'seema-work-experience.txt');
const fixtureText = fs.readFileSync(fixturePath, 'utf8');

const suspiciousEntry = [{ company: '07)', role: '(-07', startDate: '2008', endDate: '2008', highlights: [] }];

test('extractExperienceFromText pulls five work entries', () => {
  const entries = extractExperienceFromText(fixtureText);
  assert.equal(entries.length, 5);
  const companies = entries.map((entry) => (entry.company || '').toLowerCase());
  assert.ok(companies.some((name) => name.includes('citi')));
  assert.ok(companies.some((name) => name.includes('ernst')));
  assert.ok(companies.some((name) => name.includes('one network')));
  assert.ok(companies.some((name) => name.includes('infosys')));
  assert.ok(companies.some((name) => name.includes('digital group')));
  const oneNetwork = entries.find((entry) => /one network/i.test(entry.company || ''));
  assert(oneNetwork, 'One Network Enterprises entry is missing');
  assert.ok(
    oneNetwork.highlights.some((line) => /responsive front end/i.test(line)),
    'Highlights should include the responsive front end line',
  );
});

test('extractExperienceFromText treats narrative lines as highlights', () => {
  const narrativeText = `
WORK EXPERIENCE
Acme Corp
Senior Engineer (Jan 2020 - Present)
Owned technical and delivery responsibilities across products.
- Mentored three engineers and improved deployment cadence.
`;
  const entries = extractExperienceFromText(narrativeText);
  const acme = entries.find((entry) => /acme/i.test(entry.company || ''));
  assert(acme, 'Acme entry should be parsed');
  assert.ok(
    acme.highlights.some((line) => /owned technical/i.test(line)),
    'Narrative line should be captured as a highlight and not as a company',
  );
  assert.ok(
    acme.highlights.some((line) => /mentored three engineers/i.test(line)),
    'Bullet highlights should still appear after narrative sentences',
  );
});

test('finalizeExperience normalizes dates and avoids numeric fragments', () => {
  const normalized = finalizeExperience({
    experience: suspiciousEntry,
    parsed: { lines: [], sections: {} },
    fullText: fixtureText,
  });

  assert.ok(normalized.length >= 5);
  const citi = normalized.find((entry) => /citi/i.test(entry.company));
  assert(citi, 'Citi entry missing from fallback');
  assert.equal(citi.startDate, '2022-12');
  assert.equal(citi.endDate, 'Present');
  assert.ok(citi.highlights.length > 0, 'Citi entry should keep highlights');

  for (const company of normalized.map((entry) => entry.company)) {
    assert(!/^\(?-?\d{2}\)?$/.test(company), `Company should not be numeric fragment: ${company}`);
  }
  for (const role of normalized.map((entry) => entry.role)) {
    assert(!/07\)/.test(role), `Role should not contain 07) fragment: ${role}`);
  }
  for (const entry of normalized) {
    assert(!/(owned|responsible|led|worked|developed)/i.test(entry.company || ''), `Late narrative company found: ${entry.company}`);
  }
});
