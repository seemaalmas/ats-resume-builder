const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ResumeService } = require('../dist/resume/resume.service.js');

function createService() {
  return new ResumeService({});
}

function resolveFixturePath() {
  const candidates = [
    '/mnt/data/chandankumar_26Apr_12.pdf',
    'D:/chandankumar_26Apr_12.pdf',
    path.resolve(__dirname, '../../chandankumar_26Apr_12.pdf'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function resolveImpactFixturePath() {
  const fixtureName = 'resume-cmmd1j4ei0001bninaqk7xr1k.pdf';
  const localFixture = path.resolve(__dirname, 'fixtures', fixtureName);
  if (fs.existsSync(localFixture)) return localFixture;

  const externalCandidates = [
    `/mnt/data/${fixtureName}`,
    `D:/${fixtureName}`,
  ];
  for (const candidate of externalCandidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      fs.copyFileSync(candidate, localFixture);
    } catch {
      // Best-effort copy; parse directly from external path if local copy is not possible.
    }
    if (fs.existsSync(localFixture)) return localFixture;
    return candidate;
  }
  return '';
}

test('POST /resumes/parse-upload contract maps fixture resume to 4 experiences', async () => {
  const fixture = resolveFixturePath();
  assert.ok(fixture, 'Fixture PDF not found. Expected /mnt/data/chandankumar_26Apr_12.pdf or D:/chandankumar_26Apr_12.pdf');
  const service = createService();
  const result = await service.parseResumeUpload({
    originalname: 'chandankumar_26Apr_12.pdf',
    mimetype: 'application/pdf',
    buffer: fs.readFileSync(fixture),
  });

  assert.equal(result.fileName, 'chandankumar_26Apr_12.pdf');
  assert.equal(result.parsed.contact.fullName, 'Chandan Kumar');
  assert.notEqual((result.parsed.title || '').toLowerCase(), 'soft skills');
  assert.equal(result.parsed.experience.length, 4);
  const companies = result.parsed.experience.map((item) => item.company.toLowerCase());
  assert.ok(companies.some((name) => name.includes('citi')));
  assert.ok(companies.some((name) => name.includes('ernst')));
  assert.ok(companies.some((name) => name.includes('one network')));
  assert.ok(companies.some((name) => name.includes('infosys')));
  assert.equal(result.parsed.experience[0].company.toLowerCase().includes('citi'), true);
  assert.equal(result.parsed.experience[0].role.toLowerCase().includes('avp'), true);
  assert.equal(result.parsed.experience[0].startDate, '2022-12');
  assert.equal(result.parsed.experience[0].endDate, 'Present');
});

test('POST /resumes/parse-upload regression: simple text upload still maps experience', async () => {
  const service = createService();
  const simpleResume = `
Alex Rivera
Senior Software Engineer
Email: alex@example.com
Phone: +1 555 102 0044

Professional Summary
Platform engineer delivering reliable backend systems.

Work Experience
Senior Software Engineer
Acme Corp
- Improved API latency by 30%
Jan 2021 - Present

Education
B.E Computer Science
State University
2014 - 2018
`;
  const result = await service.parseResumeUpload({
    originalname: 'simple.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from(simpleResume, 'utf8'),
  });

  assert.ok(result.parsed.experience.length >= 1);
  assert.ok(result.parsed.experience.some((item) => item.company.toLowerCase().includes('acme')));
  assert.ok(result.parsed.experience.some((item) => item.role.toLowerCase().includes('engineer')));
  assert.ok(result.parsed.experience.some((item) => item.highlights.join(' ').toLowerCase().includes('latency')));
});

test('POST /resumes/parse-upload regression: impact prefixes are normalized and do not inflate experiences', async () => {
  const service = createService();
  const fixture = resolveImpactFixturePath();

  const result = fixture
    ? await service.parseResumeUpload({
      originalname: path.basename(fixture),
      mimetype: 'application/pdf',
      buffer: fs.readFileSync(fixture),
    })
    : await service.parseResumeUpload({
      originalname: 'impact-regression.txt',
      mimetype: 'text/plain',
      buffer: Buffer.from(`
Jane Doe
Professional Summary
Engineering leader focused on measurable outcomes.

Experience
AVP
Citi Corp (Pune)
Impact: Led cross-functional teams to deliver enterprise-grade applications.
Achievement: Improved release quality through CI guardrails.
Dec 2022 - Present

Senior Technology Consultant
Ernst & Young (Pune, Maharashtra)
Result: Engineered reusable template architecture for resume exports.
Highlights: Reduced frontend effort by 60% across teams.
Oct 2021 - Dec 2022

Senior Software Developer
One Network Enterprises
Accomplishment: Managed complete development lifecycle from UX planning to deployment.
Impact: Improved production reliability with better observability.
Sep 2020 - Sep 2021

Lead UI Developer
Infosys Ltd
Impact: Directed end-to-end UI delivery for FINACLE.
Impact: Standardized coding patterns for maintainability.
Jul 2014 - Aug 2020
      `, 'utf8'),
    });

  assert.ok(result.parsed.experience.length >= 1, 'Expected at least one mapped experience entry.');
  assert.ok(
    result.parsed.experience.length <= 5,
    `Expected <= 5 experience entries after normalization, got ${result.parsed.experience.length}.`,
  );
  for (const item of result.parsed.experience) {
    for (const highlight of item.highlights || []) {
      assert.ok(
        !/^\s*(?:[-*•·]+)?\s*(impact|achievement|result|highlights?|accomplishment)\s*:/i.test(String(highlight || '')),
        `Highlight should not keep legacy prefix: "${highlight}"`,
      );
    }
  }
});
