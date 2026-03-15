const assert = require('node:assert/strict');
const test = require('node:test');
const { splitConcatenatedDates } = require('../dist/resume/resume.service.js');
const { parseResumeText, mapParsedResume, normalizeText } = require('resume-intelligence');

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for splitConcatenatedDates
// ─────────────────────────────────────────────────────────────────────────────

test('splits month concatenated to company name: CorpDec 2022', () => {
  const result = splitConcatenatedDates('AVP, Citi CorpDec 2022 - Present');
  assert.ok(result.includes('Citi Corp\n'), `Should split before Dec: "${result}"`);
  assert.ok(result.includes('Dec 2022'), `Should preserve date: "${result}"`);
});

test('splits month concatenated to company name: EnterprisesSep 2020', () => {
  const result = splitConcatenatedDates('Senior Developer, One Network EnterprisesSep 2020 - Sep 2021');
  assert.ok(result.includes('Enterprises\n'), `Should split before Sep: "${result}"`);
  assert.ok(result.includes('Sep 2020'), `Should preserve date: "${result}"`);
});

test('splits month concatenated to company name: YoungJan 2010', () => {
  const result = splitConcatenatedDates('Senior Consultant, Ernst & YoungJan 2010 - Jun 2014');
  assert.ok(result.includes('Young\n'), `Should split before Jan: "${result}"`);
  assert.ok(result.includes('Jan 2010'), `Should preserve date: "${result}"`);
});

test('does NOT split standalone month names: Dec 2022', () => {
  const result = splitConcatenatedDates('Dec 2022 - Present');
  assert.ok(!result.includes('\n'), `Should not split: "${result}"`);
});

test('does NOT split full month names: December 2022', () => {
  const result = splitConcatenatedDates('Joined in December 2022 as engineer');
  assert.ok(!result.includes('\n'), `Should not split December: "${result}"`);
});

test('normalizes month+year without space: Dec2022 → Dec 2022', () => {
  const result = splitConcatenatedDates('CorpDec2022 - Present');
  assert.ok(result.includes('Dec 2022'), `Should add space: "${result}"`);
});

test('splits MM/YYYY concatenated to text: Company01/2020', () => {
  const result = splitConcatenatedDates('Company01/2020 - 12/2022');
  assert.ok(result.includes('Company\n01/2020'), `Should split before date: "${result}"`);
});

test('splits bare YYYY concatenated to text: Company2020 - Present', () => {
  const result = splitConcatenatedDates('Company2020 - Present');
  assert.ok(result.includes('Company\n2020'), `Should split before year: "${result}"`);
});

test('splits degree code from institution in education section', () => {
  const result = splitConcatenatedDates('EDUCATION\nBBIndian Institute of Technology Delhi');
  assert.ok(result.includes('BB\nIndian'), `Should split BB from Indian: "${result}"`);
});

test('does NOT split degree-institution outside education section', () => {
  const result = splitConcatenatedDates('EXPERIENCE\nBBSomething Corp');
  assert.ok(!result.includes('BB\nSomething'), `Should not split outside education: "${result}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration test: full parsing pipeline with concatenated ATS text
// ─────────────────────────────────────────────────────────────────────────────

test('full pipeline: ATS PDF with concatenated role/company/date produces correct experience', () => {
  const atsText = `Tech Lead / AVP - Full Stack Engineering
cks@gmail.com | 9307003382 | Pune

SUMMARY
10+ years of experience in the IT industry

SKILLS
React, Node.js, TypeScript

EXPERIENCE
AVP, Citi CorpDec 2022 - Present
Leading cross-functional teams to deliver enterprise-grade applications
Led a team of 10+ engineers using ReactJS and NodeJS
Senior Software Developer, One Network EnterprisesSep 2020 - Sep 2021
Led end-to-end UX implementation and frontend architecture
Managed complete development lifecycle from UX planning to deployment
Senior Technology Consultant, Ernst & YoungJan 2010 - Jun 2014
Led UX transformation and enterprise-grade frontend development
Engineered a reusable HTML template system

EDUCATION
BBIndian Institute of Technology DelhiJul 2008 - Aug 2012

-- 1 of 1 --`;

  const normalized = splitConcatenatedDates(normalizeText(atsText));
  const parsed = parseResumeText(normalized);
  const mapped = mapParsedResume(parsed);

  // Experience should have 3 entries
  assert.equal(mapped.experience.length, 3,
    `Expected 3 experiences, got ${mapped.experience.length}: ${JSON.stringify(mapped.experience.map((e) => `${e.role} @ ${e.company}`))}`);

  // Verify clean company names (no date fragments)
  const citi = mapped.experience.find((e) => e.company.toLowerCase().includes('citi'));
  assert.ok(citi, 'Missing Citi Corp experience');
  assert.equal(citi.company, 'Citi Corp', `Citi company should be clean: "${citi.company}"`);
  assert.ok(citi.role.toLowerCase().includes('avp'), `Citi role should include AVP: "${citi.role}"`);
  assert.equal(citi.startDate, 'Dec 2022');
  assert.equal(citi.endDate, 'Present');
  assert.ok(citi.highlights.length >= 2, `Citi should have >= 2 highlights, got ${citi.highlights.length}`);

  const oneNetwork = mapped.experience.find((e) => e.company.toLowerCase().includes('one network'));
  assert.ok(oneNetwork, 'Missing One Network experience');
  assert.equal(oneNetwork.company, 'One Network Enterprises', `One Network company should be clean: "${oneNetwork.company}"`);
  assert.equal(oneNetwork.startDate, 'Sep 2020');
  assert.equal(oneNetwork.endDate, 'Sep 2021');

  const ey = mapped.experience.find((e) => e.company.toLowerCase().includes('ernst'));
  assert.ok(ey, 'Missing Ernst & Young experience');
  assert.equal(ey.company, 'Ernst & Young', `EY company should be clean: "${ey.company}"`);
  assert.equal(ey.startDate, 'Jan 2010');
  assert.equal(ey.endDate, 'Jun 2014');

  // Education
  assert.ok(mapped.education.length >= 1, `Expected >= 1 education, got ${mapped.education.length}`);
  const edu = mapped.education[0];
  assert.ok(edu.institution.toLowerCase().includes('technology') || edu.institution.toLowerCase().includes('delhi'),
    `Institution should be IIT Delhi: "${edu.institution}"`);
  assert.notEqual(edu.institution, 'BB', 'Institution should not be BB');

  // Role level
  assert.notEqual(mapped.roleLevel, 'FRESHER', 'Should not be FRESHER for 10+ years');
});

console.log('splitConcatenatedDates tests registered');
