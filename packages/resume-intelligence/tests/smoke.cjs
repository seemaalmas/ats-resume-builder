const assert = require('node:assert/strict');
const { parseResumeText, mapParsedResume, computeExperienceLevel } = require('../dist/index.js');

const sample = `
Jane Doe
jane@example.com | +1 555 000 9999

Profile
Senior software engineer building distributed systems.

Core Skills
Node.js, TypeScript, PostgreSQL, AWS

Employment History
Senior Engineer - Acme Corp | Jan 2022 - Present
- Led migration that reduced deployment time by 45%
- Mentored 5 engineers
Engineer - Beta Labs | 2019 - 2021
- Built integrations used by 100+ enterprise customers
Platform Lead @ Gamma Systems | 2017 - 2019
- Managed platform modernization across 3 teams
Freelance | 2016 - 2017
- —

Academic Background
BS Computer Science - State University | 2015 - 2019
`;

const parsed = parseResumeText(sample);
const mapped = mapParsedResume(parsed);
const level = computeExperienceLevel({
  resumeText: `${mapped.summary} ${mapped.skills.join(' ')}`,
  experience: mapped.experience,
});

assert.ok(mapped.summary.toLowerCase().includes('senior software engineer'));
assert.ok(mapped.skills.includes('TypeScript'));
assert.ok(mapped.experience.length >= 3);
assert.ok(mapped.experience.some((item) => item.company.toLowerCase().includes('acme')));
assert.ok(mapped.experience.some((item) => item.company.toLowerCase().includes('beta')));
assert.ok(mapped.experience.some((item) => item.company.toLowerCase().includes('gamma')));
assert.ok(mapped.experience.every((item) => item.company.length >= 2));
assert.ok(mapped.experience.every((item) => item.role.length >= 2 || /freelance/i.test(item.company)));
assert.ok(mapped.experience.every((item) => item.startDate.length >= 4 || item.endDate.length >= 4 || item.highlights.length >= 1));
assert.equal(level.level, 'SENIOR');

console.log('resume-intelligence smoke test passed');
