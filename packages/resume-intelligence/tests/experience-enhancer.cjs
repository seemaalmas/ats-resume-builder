const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const {
  parseResumeText,
  normalizeText,
  mapParsedResume,
} = require('../dist/index.js');
const {
  enhanceExperienceExtraction,
  extractExperienceFromWorkExperienceSection,
} = require('../dist/experience-enhancer.js');

const samples = [
  { path: '/mnt/data/seemaalmasyunusshaikh.pdf', minEntries: 2 },
  { path: '/mnt/data/chandankumar_26Apr_12.pdf', minEntries: 2 },
  { path: '/mnt/data/CHANDAN KUMAR.docx', minEntries: 3 },
];
const fixturePath = path.resolve(__dirname, 'fixtures', 'seema-work-experience.txt');

async function extractText(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (filePath.toLowerCase().endsWith('.pdf')) {
    const result = await pdfParse(buffer);
    return result.text || '';
  }
  if (filePath.toLowerCase().endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }
  return buffer.toString('utf-8');
}

async function parseExperienceFromFile(filePath) {
  const text = await extractText(filePath);
  const normalized = normalizeText(text);
  const parsed = parseResumeText(normalized);
  const mapped = mapParsedResume(parsed);
  return mapped.experience;
}

function assertWorkExperienceFixture() {
  const text = fs.readFileSync(fixturePath, 'utf8');
  const normalized = normalizeText(text);
  const parsed = parseResumeText(normalized);
  const extracted = extractExperienceFromWorkExperienceSection(normalized, parsed);
  assert.equal(extracted.length, 5, 'Expected the fixture to yield five experience entries');
  const [first] = extracted;
  assert(first.company.toLowerCase().includes('citi'), 'First entry should be Citi Corp');
  assert.equal(first.startDate, 'Dec 2022');
  assert.equal(first.endDate, 'Present');
  assert(first.highlights.length > 0, 'First entry should surface highlights');
  assert.ok(extracted.some((item) => /ernst/i.test(item.company || '')), 'Should capture Ernst & Young');
  const fallback = enhanceExperienceExtraction({
    rawText: normalized,
    parsed,
    currentExperience: [{ company: '07)', role: '(-07', startDate: '2008', endDate: '2009', highlights: [] }],
  });
  assert.strictEqual(fallback.length, extracted.length, 'Fallback should replace suspicious experience');
  assert(fallback.some((item) => /one network/i.test(item.company || '')), 'Fallback should capture One Network Enterprises');
}

async function run() {
  assertWorkExperienceFixture();
  const processed = [];
  for (const sample of samples) {
    if (!fs.existsSync(sample.path)) {
      console.warn(`Skipping ${sample.path} (file not found).`);
      continue;
    }
    const experience = await parseExperienceFromFile(sample.path);
    assert(
      experience.length >= sample.minEntries,
      `Expected at least ${sample.minEntries} experience entries for ${path.basename(sample.path)} but found ${experience.length}`,
    );
    processed.push(experience);
  }

  if (!processed.length) {
    console.warn('No sample files were available; skipping combined assertions.');
    return;
  }

  const combinedExperience = processed.flat();
  assert(
    combinedExperience.some((item) => /citi/i.test(item.company || '')),
    'Expected to find a company with "Citi" in the extracted experience',
  );
  assert(
    combinedExperience.some((item) => /(vice president|avp)/i.test(item.role || '')),
    'Expected to find a role including "Vice President" or "AVP"',
  );
  assert(
    combinedExperience.some((item) => /(present|current)/i.test(item.endDate || '')),
    'Expected to find an experience entry with end date including Present/Current',
  );

  const baseline = [{ company: 'Acme', role: 'Engineer', startDate: '', endDate: '', highlights: [] }];
  const enhanced = enhanceExperienceExtraction({
    rawText: '',
    currentExperience: baseline,
  });
  assert.strictEqual(enhanced, baseline, 'Enhancer should not overwrite existing valid experience');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
