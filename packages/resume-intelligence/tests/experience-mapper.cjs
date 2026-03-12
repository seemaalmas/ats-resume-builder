const assert = require('node:assert/strict');
const { mapParsedResume, parseResumeText } = require('../dist/index.js');

function mapResume(text) {
  return mapParsedResume(parseResumeText(text));
}

function normalizedCompanies(experience) {
  return experience.map((item) => item.company.toLowerCase().replace(/[^a-z0-9]/g, ''));
}

function isStrongCompany(name) {
  if (!name) return false;
  if (/(inc|llc|ltd|corp|company|technologies|systems|labs|solutions|group|studio|partners|bank|consulting|digital)/i.test(name)) {
    return true;
  }
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 7) return false;
  const titleCaseTokens = tokens.filter((token) => /^[A-Z][A-Za-z0-9&'.-]*$/.test(token)).length;
  return titleCaseTokens >= Math.ceil(tokens.length * 0.6);
}

// 1) Single-company extraction
{
  const mapped = mapResume(`
Alex Johnson

Experience
Software Engineer @ Acme Corporation | Jan 2021 - Present
- Improved API p95 latency by 32% through query optimization
`);

  assert.equal(mapped.experience.length, 1);
  assert.ok(mapped.experience[0].company.toLowerCase().includes('acme'));
  assert.ok(mapped.experience[0].role.toLowerCase().includes('software engineer'));
  assert.equal(mapped.experience[0].startDate, 'Jan 2021');
  assert.equal(mapped.experience[0].endDate, 'Present');
  assert.ok(mapped.experience[0].highlights.length >= 1);
}

// 2) Three-plus companies preserved and heading synonym recognized
{
  const mapped = mapResume(`
Taylor Lee

EMPLOYMENT HISTORY
Senior Engineer - Northwind Labs | 2022 - Present
- Led migration that improved throughput by 41%
Platform Engineer - Contoso Systems | 2019 - 2022
- Built observability stack for 80+ services
Developer - Fabrikam Digital | 2017 - 2019
- Reduced incident resolution time by 29%
`);

  assert.equal(mapped.experience.length, 3);
  const companies = normalizedCompanies(mapped.experience);
  assert.ok(companies.some((company) => company.includes('northwind')));
  assert.ok(companies.some((company) => company.includes('contoso')));
  assert.ok(companies.some((company) => company.includes('fabrikam')));
}

// 3) Multiple roles under one company retained
{
  const mapped = mapResume(`
Morgan Patel

Professional Experience
Acme Systems
Principal Engineer | Jan 2022 - Present
- Directed platform modernization across 4 product lines
Senior Engineer | Jan 2020 - Dec 2021
- Increased release frequency by 3x using CI hardening
Beta Labs | Platform Engineer | 2018 - 2019
- Automated compliance checks reducing review time by 40%
`);

  const acmeRoles = mapped.experience
    .filter((item) => item.company.toLowerCase().includes('acme'))
    .map((item) => item.role.toLowerCase());

  assert.equal(acmeRoles.length, 2);
  assert.ok(acmeRoles.some((role) => role.includes('principal')));
  assert.ok(acmeRoles.some((role) => role.includes('senior')));
  assert.ok(mapped.experience.some((item) => item.company.toLowerCase().includes('beta')));
}

// 4) Role-at-company formats and date formats are normalized
{
  const mapped = mapResume(`
Jordan Kim

WORK HISTORY
Lead Engineer at Cedar Works | Aug 2019 - Present
- Improved release reliability by 27%
Software Developer - Orion Labs | 2017-2020
- Built APIs for billing platform
Company - Product Architect | 2018 – 2021
- Delivered migration roadmap
`);

  assert.equal(mapped.experience.length, 3);
  assert.ok(mapped.experience.some((item) => item.role.toLowerCase().includes('lead engineer') && item.company.toLowerCase().includes('cedar')));
  assert.ok(mapped.experience.some((item) => item.startDate === 'Aug 2019' && item.endDate === 'Present'));
  assert.ok(mapped.experience.some((item) => item.startDate === '2017' && item.endDate === '2020'));
  assert.ok(mapped.experience.some((item) => item.startDate === '2018' && item.endDate === '2021'));
}

// 5) Partial/ambiguous entries move to unmapped and valid companies survive
{
  const mapped = mapResume(`
Chandan Kumar

Work Experience
AVP
Citi Corp (Pune)
- Led cross-functional teams to deliver enterprise-grade applications
Senior Technology Consultant
Ernst & Young (Pune, Maharashtra)
- Engineered reusable templates and reduced frontend effort by 60%
Dec 2022 - Present
Oct 2021 - Dec 2022 -- 1 of 3 -- Education
`);

  assert.ok(mapped.experience.some((item) => item.company.toLowerCase().includes('citi')));
  assert.ok(mapped.experience.some((item) => item.role.toLowerCase().includes('avp')));
  assert.ok(mapped.experience.some((item) => item.company.toLowerCase().includes('ernst')));
  assert.ok(mapped.experience.some((item) => item.startDate === 'Dec 2022' && item.endDate === 'Present'));
}

// 6) Partial/ambiguous entries move to unmapped and valid companies survive
{
  const mapped = mapResume(`
Jordan Kim

Experience
N/A | 2020 - 2021
- Maintained internal tooling
Software Engineer | 2021 - Present
- Improved API latency by 28%
Example Corp
- Led migration to cloud
Intern @ Valid Corp | 2019 - 2020
- Automated reporting pipeline by 30%
`);

  assert.ok(mapped.experience.every((item) => item.company.trim().length >= 2));
  assert.ok(mapped.experience.every((item) => item.role.trim().length >= 2 || isStrongCompany(item.company)));
  assert.ok(mapped.experience.some((item) => item.company.toLowerCase().includes('valid corp')));
  assert.ok(!mapped.experience.some((item) => /^n\/a$/i.test(item.company || '')));
}

// 7) Two companies + four roles + mixed date formats remain distinct
{
  const mapped = mapResume(`
Riley Sharma

Work Experience
Citi Corp (Pune)
AVP | Dec 2022 - Present
- Led cross-functional platform delivery
Engineering Manager | 01/2021 - 11/2022
- Reduced release failures by 35%
Ernst & Young (Pune, Maharashtra)
Senior Technology Consultant | Oct 2020 - Dec 2020
- Improved developer velocity by 25%
Technology Consultant | 2018 - 2019
- Standardized UI workflows across teams
`);

  const distinctCompanies = new Set(normalizedCompanies(mapped.experience));
  assert.equal(mapped.experience.length, 4);
  assert.equal(distinctCompanies.size, 2);
  assert.ok(mapped.signals.rolesWithDateCount > 0);
}

// 8) Real extracted PDF pattern with section spillover still yields 4 roles
{
  const mapped = mapResume(`
Professional Summary
- 10+ years of experience in the IT industry.
Work Experience
Communication
Teamwork
Leadership
Problem-solving
HTML5
CSS3
JavaScript
ReactJS
Redux
NodeJS
MongoDB
Polymer JS
Mobx
NextJS
Python
Flutter
AVP
Citi Corp (Pune)
- Led cross-functional teams to deliver enterprise-grade applications
Senior Technology Consultant
Ernst & Young (Pune, Maharashtra)
- Engineered a reusable HTML template system using React & HTML5
Dec 2022 - Present
Oct 2021 - Dec 2022
-- 1 of 3 --
Education
B.E: Telecommunication Engineering
Siddaganga Institute, Tumkūr, KA
(Jan 2010 - Jun 2014)
Associate of Science: Science
A.N.S.M College, Aurangabad, BR
(Jan 2007 - May 2010)
High School Diploma
D.A.V Public School, Patna
(Apr 2006 - Apr 2007)
Senior Software Developer
One Network Enterprises
- Managed complete development lifecycle from UX planning to deployment
Lead UI Developer
Infosys Ltd
- Directed end-to-end UI development for FINACLE
Sep 2020 - Sep 2021
Jul 2014 - Aug 2020
-- 2 of 3 --
Achievements
`);

  assert.equal(mapped.experience.length, 4);
  assert.ok(mapped.experience.some((item) => item.company.toLowerCase().includes('citi')));
  assert.ok(mapped.experience.some((item) => item.company.toLowerCase().includes('ernst')));
  assert.ok(mapped.experience.some((item) => item.company.toLowerCase().includes('one network')));
  assert.ok(mapped.experience.some((item) => item.company.toLowerCase().includes('infosys')));
  assert.ok(mapped.signals.rolesWithDateCount > 0);
  assert.ok(mapped.signals.estimatedTotalMonths > 0);
}

// 9) Header mapping rejects heading noise and captures name + headline/title
{
  const mapped = mapResume(`
Soft Skills
Technical Skills
Chandan Kumar
Tech Lead | AVP - Full Stack Engineering | Frontend Strategist
Mobile No: 9307003382 Email Id: cks011992@gmail.com Address: Pune, MH 411057 Date of Birth: 01-01-1992
LinkedIn: https://www.linkedin.com/in/chandankumar007
Work Experience
AVP
Citi Corp (Pune)
- Led cross-functional platform delivery
Dec 2022 - Present
`);

  assert.notEqual((mapped.title || '').toLowerCase(), 'soft skills');
  assert.equal(mapped.contact?.fullName, 'Chandan Kumar');
  assert.equal(mapped.contact?.email, 'cks011992@gmail.com');
  assert.ok((mapped.title || '').toLowerCase().includes('tech lead'));
  assert.ok((mapped.title || '').toLowerCase().includes('avp'));
}

// 10) Standalone date lines map to role blocks in insertion order (no date swapping)
{
  const mapped = mapResume(`
Work Experience
AVP
Citi Corp (Pune)
- Led cross-functional platform delivery
Senior Technology Consultant
Ernst & Young (Pune, Maharashtra)
- Improved developer velocity by 25%
Dec 2022 - Present
Oct 2021 - Dec 2022
`);

  const citi = mapped.experience.find((item) => item.company.toLowerCase().includes('citi'));
  const ey = mapped.experience.find((item) => item.company.toLowerCase().includes('ernst'));
  assert.ok(citi);
  assert.ok(ey);
  assert.equal(citi.startDate, 'Dec 2022');
  assert.equal(citi.endDate, 'Present');
  assert.equal(ey.startDate, 'Oct 2021');
  assert.equal(ey.endDate, 'Dec 2022');
}

// 11) Legacy impact-style prefixes should not create extra experience entries
{
  const mapped = mapResume(`
Professional Experience
AVP
Citi Corp
Impact: Led cross-functional teams to deliver enterprise-grade applications.
Achievement: Improved release quality through CI guardrails.
Dec 2022 - Present
Senior Technology Consultant
Ernst & Young
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
  `);

  assert.ok(mapped.experience.length <= 5, `Expected <= 5 entries, got ${mapped.experience.length}`);
  for (const item of mapped.experience) {
    for (const line of item.highlights || []) {
      assert.ok(!/^\s*(impact|achievement|result|highlights?|accomplishment)\s*:/i.test(line), `Unexpected legacy prefix in "${line}"`);
    }
  }
}

console.log('experience mapper tests passed');
