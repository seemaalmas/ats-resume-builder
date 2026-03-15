/**
 * ATS resume round-trip test: parse → map → verify fields survive the pipeline.
 *
 * Tests that a resume with Unicode ligatures, non-standard section headings,
 * and multi-company experience is correctly parsed end-to-end.
 */
const assert = require('node:assert/strict');
const { parseResumeText, mapParsedResume, normalizeText } = require('../dist/index.js');

// Simulate text from a real ATS-formatted PDF with:
// - Unicode fi/fl ligatures (ﬁ, ﬂ)
// - ALL CAPS section headings with ligature drops
// - Multiple companies and roles
// - 10+ years experience
const rawResumeText = `Tech Lead / AVP - Full Stack Engineering / Frontend Strategist
ncks011992@gmail.com | 9307003382 | Pune, MH 411057 | https://www.linkedin.com/in/chandankumar007

SUMMARY
- 10+ years of experience in the IT industry with a strong track record of delivering high-ROI software solutions for enterprise clients in the \uFB01nancial sector.
- Hands-on expertise in full-stack web development, frontend architecture, and team leadership.
- Proven ability to drive cross-functional collaboration and optimize development work\uFB02ows.

KEY COMPETENCIES
JavaScript, TypeScript, React.js, Angular, Vue.js, Node.js, Express.js, MongoDB, PostgreSQL, AWS
Docker, Kubernetes, CI/CD, Git, Agile methodologies, agile planning, driving innovation, Java

PRO ESSIONAL EXPERIENCE

Tech Lead / AVP - Barclays
Jan 2022 - Present
- Led frontend architecture modernization across 3 product lines serving 2M+ users
- Mentored team of 8 engineers on React best practices and code quality standards
- Reduced page load times by 40% through code splitting and lazy loading strategies
- Implemented micro-frontend architecture reducing deployment coupling

Senior Frontend Developer - Infosys
Jul 2018 - Dec 2021
- Built enterprise dashboard used by 500+ internal users for real-time analytics
- Implemented micro-frontend architecture for legacy application migration
- Drove adoption of TypeScript across 5 development teams
- Created reusable component library saving 200+ developer hours per quarter

Frontend Developer - Tata Consultancy Services
Jun 2015 - Jun 2018
- Developed responsive web applications for banking and \uFB01nancial services clients
- Created reusable component library reducing development time by 30%
- Collaborated with UX team to implement accessible UI patterns

Junior Developer - Wipro Technologies
Aug 2013 - May 2015
- Built internal tools for project management and resource allocation
- Participated in agile ceremonies and contributed to sprint planning

EDUCATION
Bachelor of Engineering in Computer Science - Siddhant College of Engineering, Pune University
2009 - 2013

CERTI\uFB01CATIONS
AWS Solutions Architect Associate - 2023
Professional Scrum Master I (PSM I) - 2022
`;

// Step 1: normalizeText fixes ligatures
const normalized = normalizeText(rawResumeText);
assert.ok(normalized.includes('financial'), 'fi ligature resolved in financial');
assert.ok(normalized.includes('workflows'), 'fl ligature resolved in workflows');
assert.ok(!normalized.includes('\uFB01'), 'no ﬁ ligature chars remaining');
assert.ok(!normalized.includes('\uFB02'), 'no ﬂ ligature chars remaining');

// Step 2: parseResumeText detects all sections
const parsed = parseResumeText(rawResumeText);
const sections = Object.keys(parsed.sections);
assert.ok(sections.includes('summary'), 'summary section detected');
assert.ok(sections.includes('skills'), 'skills section detected (from KEY COMPETENCIES)');
assert.ok(sections.includes('experience'), 'experience section detected (from PRO ESSIONAL EXPERIENCE)');
assert.ok(sections.includes('education'), 'education section detected');
assert.ok(sections.includes('certifications'), 'certifications section detected (through ﬁ ligature)');

// Step 3: mapParsedResume produces complete output
const mapped = mapParsedResume(parsed);

// Title
assert.ok(mapped.title.includes('Tech Lead'), `title contains Tech Lead: ${mapped.title}`);

// Contact
assert.ok(mapped.contact, 'contact extracted');
assert.ok(mapped.contact?.email?.includes('ncks011992'), `email extracted: ${mapped.contact?.email}`);

// Summary
assert.ok(mapped.summary.includes('10+'), 'summary has 10+ years');
assert.ok(mapped.summary.includes('financial'), 'ligature resolved in summary');

// Skills
assert.ok(mapped.skills.length >= 10, `skills count ${mapped.skills.length} >= 10`);
assert.ok(mapped.skills.includes('JavaScript'), 'JavaScript in skills');
assert.ok(mapped.skills.includes('TypeScript'), 'TypeScript in skills');
assert.ok(mapped.skills.includes('React.js'), 'React.js in skills');
assert.ok(mapped.skills.includes('Node.js'), 'Node.js in skills');
assert.ok(mapped.skills.includes('AWS'), 'AWS in skills');

// Experience
assert.ok(mapped.experience.length >= 3, `experience count ${mapped.experience.length} >= 3`);
const companies = mapped.experience.map((e) => e.company.toLowerCase());
assert.ok(companies.some((c) => c.includes('barclays')), 'Barclays in experience');
assert.ok(companies.some((c) => c.includes('infosys')), 'Infosys in experience');
assert.ok(
  companies.some((c) => c.includes('tata') || c.includes('tcs') || c.includes('consultancy')),
  'TCS/Tata in experience',
);

// Verify experience entries have highlights
for (const exp of mapped.experience) {
  assert.ok(exp.highlights.length >= 1, `${exp.company} has at least 1 highlight`);
}

// Verify dates are present
const withDates = mapped.experience.filter((e) => e.startDate || e.endDate);
assert.ok(withDates.length >= 3, `${withDates.length} experience entries have dates`);

// Education
assert.ok(mapped.education.length >= 1, `education count ${mapped.education.length} >= 1`);
const edu = mapped.education[0];
assert.ok(
  (edu.institution && edu.institution.toLowerCase().includes('pune')) ||
  (edu.degree && edu.degree.toLowerCase().includes('engineering')),
  'education institution or degree found',
);

// Certifications
assert.ok(mapped.certifications.length >= 1, `certifications count ${mapped.certifications.length} >= 1`);

// Role level
assert.equal(mapped.roleLevel, 'SENIOR', 'roleLevel is SENIOR (not FRESHER)');
assert.ok(mapped.signals.roleCount >= 3, `roleCount ${mapped.signals.roleCount} >= 3`);
assert.ok(mapped.signals.distinctCompanyCount >= 3, `distinctCompanyCount ${mapped.signals.distinctCompanyCount} >= 3`);
assert.ok(mapped.signals.estimatedTotalMonths >= 100, `estimatedTotalMonths ${mapped.signals.estimatedTotalMonths} >= 100`);

console.log('ats-roundtrip test passed');
