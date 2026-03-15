/**
 * Tests for Unicode ligature normalization in section heading detection.
 *
 * Root cause: pdf-parse extracts text from PDFs where fonts use Unicode
 * ligature characters (ﬁ U+FB01, ﬂ U+FB02, etc.). These ligatures break
 * section heading detection because normalizeHeading strips non-[a-z\s]
 * chars, turning "Professional" into "Pro essional" (unrecognized).
 *
 * Fix: normalizeText() and normalizeHeading() now replace ligature chars
 * with their ASCII equivalents before further processing.
 */
const assert = require('node:assert/strict');
const { normalizeText, normalizeHeading, parseResumeText, mapParsedResume } = require('../dist/index.js');

// --- 1. normalizeText ligature replacement ---
console.log('  [1/5] normalizeText replaces Unicode ligatures');
assert.ok(normalizeText('\uFB01nancial').includes('financial'), 'ﬁ → fi in financial');
assert.ok(normalizeText('Pro\uFB01le').includes('Profile'), 'ﬁ → fi in Profile');
assert.ok(normalizeText('\uFB02oor').includes('floor'), 'ﬂ → fl in floor');
assert.ok(normalizeText('\uFB00ect').includes('ffect'), 'ﬀ → ff');
assert.ok(normalizeText('\uFB03ce').includes('ffice'), 'ﬃ → ffi');
assert.ok(normalizeText('\uFB04e').includes('ffle'), 'ﬄ → ffl');

// --- 2. normalizeHeading detects ligature-affected headings ---
console.log('  [2/5] normalizeHeading handles ligature variants');
// Unicode ligature characters in headings
assert.equal(normalizeHeading('CERTI\uFB01CATIONS'), 'certifications');
assert.equal(normalizeHeading('PRO\uFB01LE SUMMARY'), 'summary');
assert.equal(normalizeHeading('QUALI\uFB01CATIONS'), 'education');

// Dropped ligatures (space left where fi/fl was)
assert.equal(normalizeHeading('Pro essional Experience'), 'experience');
assert.equal(normalizeHeading('PRO ESSIONAL EXPERIENCE'), 'experience');
assert.equal(normalizeHeading('Certi cations'), 'certifications');
assert.equal(normalizeHeading('Pro le Summary'), 'summary');
assert.equal(normalizeHeading('Quali cations'), 'education');

// Normal headings still work
assert.equal(normalizeHeading('PROFESSIONAL EXPERIENCE'), 'experience');
assert.equal(normalizeHeading('SKILLS'), 'skills');
assert.equal(normalizeHeading('EDUCATION'), 'education');
assert.equal(normalizeHeading('CERTIFICATIONS'), 'certifications');
assert.equal(normalizeHeading('Summary'), 'summary');

// --- 3. New section heading synonyms ---
console.log('  [3/5] New section heading synonyms recognized');
assert.equal(normalizeHeading('Key Competencies'), 'skills');
assert.equal(normalizeHeading('KEY COMPETENCIES'), 'skills');
assert.equal(normalizeHeading('Technical Expertise'), 'skills');
assert.equal(normalizeHeading('Skill Set'), 'skills');
assert.equal(normalizeHeading('Functional Skills'), 'skills');
assert.equal(normalizeHeading('Domain Expertise'), 'skills');

// --- 4. parseResumeText with ligature-containing resume ---
console.log('  [4/5] parseResumeText detects sections through ligatures');
const resumeWithLigatures = `Chandan Kumar
ncks011992@gmail.com | 9307003382 | Pune, MH 411057

SUMMARY
- 10+ years of experience in the \uFB01nancial sector.

KEY COMPETENCIES
JavaScript, TypeScript, React, Angular, Node.js
Agile methodologies, agile planning, driving innovation, Java

PRO ESSIONAL EXPERIENCE
Tech Lead / AVP - Barclays
Jan 2022 - Present
- Led frontend architecture modernization across 3 product lines

Senior Frontend Developer - Infosys
Jul 2018 - Dec 2021
- Built enterprise dashboard used by 500+ internal users

Frontend Developer - TCS
Jun 2015 - Jun 2018
- Developed responsive web applications

EDUCATION
B.E. Computer Science - Siddhant College of Engineering, Pune University
2011 - 2015

CERTI\uFB01CATIONS
AWS Solutions Architect Associate - 2023
`;

const parsed = parseResumeText(resumeWithLigatures);
const sectionKeys = Object.keys(parsed.sections);
assert.ok(sectionKeys.includes('summary'), 'summary section detected');
assert.ok(sectionKeys.includes('skills'), 'skills section detected (from KEY COMPETENCIES)');
assert.ok(sectionKeys.includes('experience'), 'experience section detected (from PRO ESSIONAL EXPERIENCE)');
assert.ok(sectionKeys.includes('education'), 'education section detected');
assert.ok(sectionKeys.includes('certifications'), 'certifications section detected (through ﬁ ligature)');

// Verify section content counts
assert.ok(parsed.sections.summary.length >= 1, 'summary has content');
assert.ok(parsed.sections.skills.length >= 2, 'skills has content');
assert.ok(parsed.sections.experience.length >= 6, 'experience has content');
assert.ok(parsed.sections.education.length >= 1, 'education has content');

// --- 5. mapParsedResume produces correct output ---
console.log('  [5/5] mapParsedResume extracts data correctly');
const mapped = mapParsedResume(parsed);

assert.ok(mapped.title, 'title extracted');
assert.ok(mapped.summary.includes('10+'), 'summary has content');
assert.ok(mapped.summary.includes('financial'), 'ligature resolved in summary text');
assert.ok(mapped.skills.length >= 8, `skills count ${mapped.skills.length} >= 8`);
assert.ok(mapped.skills.includes('JavaScript'), 'JavaScript in skills');
assert.ok(mapped.skills.includes('TypeScript'), 'TypeScript in skills');
assert.ok(mapped.experience.length >= 2, `experience count ${mapped.experience.length} >= 2`);
assert.ok(mapped.experience.some((e) => e.company.toLowerCase().includes('barclays')), 'Barclays in experience');
assert.ok(mapped.experience.some((e) => e.company.toLowerCase().includes('infosys')), 'Infosys in experience');
assert.ok(mapped.education.length >= 1, `education count ${mapped.education.length} >= 1`);
assert.ok(mapped.certifications.length >= 1, `certifications count ${mapped.certifications.length} >= 1`);
assert.equal(mapped.roleLevel, 'SENIOR', 'roleLevel is SENIOR (not FRESHER)');
assert.ok(mapped.signals.roleCount >= 2, `roleCount ${mapped.signals.roleCount} >= 2`);

console.log('ligature-parser tests passed');
