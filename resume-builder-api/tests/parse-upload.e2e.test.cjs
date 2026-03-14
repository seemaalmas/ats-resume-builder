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

test('POST /resumes/parse-upload regression: ATS-exported PDF text round-trips correctly', async () => {
  const service = createService();
  const atsResumeText = `
Chandan Kumar
cks011992@gmail.com | +91-9307003382 | Pune, MH 411057 | https://www.linkedin.com/in/chandankumar007

SUMMARY
10+ years of experience in the IT industry with expertise in full-stack development, agile planning, and driving innovation across enterprise platforms.

SKILLS
JavaScript, React, Node.js, TypeScript, Angular, HTML, CSS, AWS, Docker, Git, Agile methodologies, CI/CD, MongoDB, PostgreSQL, Redis, Microservices, REST APIs, GraphQL, Kubernetes

EXPERIENCE
AVP - Full Stack Engineer, Citi Corp
Dec 2022 - Present
Led cross-functional teams to deliver enterprise-grade applications
Architected scalable microservices using Node.js and React
Improved release quality through CI guardrails

Senior Technology Consultant, Ernst & Young
Oct 2021 - Dec 2022
Engineered reusable template architecture for resume exports
Reduced frontend effort by 60% across teams

Senior Software Developer, One Network Enterprises
Sep 2020 - Sep 2021
Managed complete development lifecycle from UX planning to deployment
Improved production reliability with better observability

Lead UI Developer, Infosys Ltd
Jul 2014 - Aug 2020
Directed end-to-end UI delivery for FINACLE
Standardized coding patterns for maintainability

EDUCATION
Master of Computer Applications
Savitribai Phule Pune University
2012 - 2014

Bachelor of Computer Applications
University of Pune
2009 - 2012

CERTIFICATIONS
AWS Certified Solutions Architect
Amazon Web Services | 2023
`;

  const result = await service.parseResumeUpload({
    originalname: 'ats-export.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from(atsResumeText, 'utf8'),
  });

  // Contact
  assert.equal(result.parsed.contact.fullName, 'Chandan Kumar');
  assert.equal(result.parsed.contact.email, 'cks011992@gmail.com');

  // Experience: 4 entries with correct role/company splits
  assert.equal(result.parsed.experience.length, 4, `Expected 4 experiences, got ${result.parsed.experience.length}`);
  const companies = result.parsed.experience.map((item) => item.company.toLowerCase());
  assert.ok(companies.some((c) => c.includes('citi')), 'Missing Citi Corp');
  assert.ok(companies.some((c) => c.includes('ernst')), 'Missing Ernst & Young');
  assert.ok(companies.some((c) => c.includes('one network')), 'Missing One Network');
  assert.ok(companies.some((c) => c.includes('infosys')), 'Missing Infosys');

  // AVP entry should have correct role (not truncated to just "AVP")
  const citi = result.parsed.experience.find((item) => item.company.toLowerCase().includes('citi'));
  assert.ok(citi.role.toLowerCase().includes('avp') || citi.role.toLowerCase().includes('full stack'),
    `Citi role should contain AVP or Full Stack: "${citi.role}"`);
  assert.ok(citi.startDate, 'Citi should have a start date');
  assert.ok(citi.endDate, 'Citi should have an end date');
  assert.ok(citi.highlights.length >= 1, 'Citi should have highlights');

  // Skills: should extract most items (not just 3)
  assert.ok(result.parsed.skills.length >= 10, `Expected >= 10 skills, got ${result.parsed.skills.length}`);

  // Education
  assert.ok(result.parsed.education.length >= 2, `Expected >= 2 education, got ${result.parsed.education.length}`);

  // Certifications
  assert.ok(result.parsed.certifications.length >= 1, `Expected >= 1 certifications, got ${result.parsed.certifications.length}`);

  // Role level should NOT be FRESHER
  assert.notEqual(result.parsed.roleLevel, 'FRESHER', 'Role level should not be FRESHER for 10+ years exp');
});
