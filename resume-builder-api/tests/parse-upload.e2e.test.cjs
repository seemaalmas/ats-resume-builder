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
  assert.equal(result.parsed.experience[0].startDate, 'Dec 2022');
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
