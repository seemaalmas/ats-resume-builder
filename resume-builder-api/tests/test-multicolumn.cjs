const { normalizeUploadText } = require('../dist/resume/resume.service.js');
const { parseResumeText, mapParsedResume } = require('../../packages/resume-intelligence/dist/index.js');

const text = `SOFT SKILLS

TECHNICAL SKILLS
Chandan Kumar
Tech Lead | AVP - Full Stack Engineering | Frontend Strategist
Mobile No: 9307003382 Email Id: cks011992@gmail.com
Address: Pune, MH 411057
Date of Birth: 01-01-1992
LinkedIn: https://www.linkedin.com/in/chandankumar007
Accomplished technology leader with 10+ years of experience driving product innovation, scalable system design, and high-performing
engineering teams in the nancial services sector. As an Assistant Vice President, I've led cross-functional squads through successful
delivery of React and Node-based enterprise platforms, modernized legacy systems, and aligned digital initiatives with business
strategy. I bring deep expertise in frontend and backend development, Agile methodologies, and stakeholder collaboration - all focused
on operational excellence, user experience, and measurable business outcomes.
I thrive on mentoring teams, building scalable architectures, and creating value through the strategic use of technology

PROFESSIONAL SUMMARY
- 10+ years of experience in the IT industry with a strong track record of delivering
high-ROI software solutions for enterprise clients in the nancial sector.
- Hands-on expertise in ReactJS, Redux, NodeJS, MongoDB, PolymerJS, and full-stack
architecture - used to modernize legacy platforms and increase performance by up to
35%.
- Led cross-functional teams of 10+ developers across multiple geographies
- Successfully aligned technology initiatives with business goals

WORK EXPERIENCE
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
Leading cross-functional teams (10+ members) to deliver enterprise-grade applications
- Led a team of 10+ engineers to deliver high-performance frontend modules using ReactJS and NodeJS
- Partnered with Product Owners to redene UI workows
- Championed code reviews, architecture discussions
Senior Technology Consultant
Ernst & Young (Pune, Maharashtra)
Led UX transformation and enterprise-grade frontend development using React
- Engineered a reusable HTML template system using React & HTML5

PROJECTS
- Standardized UI best practices across teams
Dec 2022 - Present
Oct 2021 - Dec 2022

-- 1 of 3 --

EDUCATION
B.E: Telecommunication Engineering
Siddaganga Institute, Tumkur, KA
(Jan 2010 - Jun 2014)
Associate of Science: Science
A.N.S.M College, Aurangabad, BR
(Jan 2007 - May 2010)
High School Diploma
D.A.V Public School, Patna
(Apr 2006 - Apr 2007)
Senior Software Developer
One Network Enterprises
Led end-to-end UX implementation and frontend architecture using ReactJS
- Managed complete development lifecycle from UX planning to deployment
- Designed enterprise-grade UX mockups
Lead UI Developer
Infosys Ltd
Led frontend development and architectural decisions for FINACLE UI

EXPERIENCE
across modules
- Authored solution design documents
Sep 2020 - Sep 2021
Jul 2014 - Aug 2020

-- 2 of 3 --

ACHIEVEMENTS
Spearheaded the Speedboat Project

LANGUAGES
English, Hindi
#CreatedByOutspark#

-- 3 of 3 --`;

console.log('=== STEP 1: normalizeUploadText ===');
const normalized = normalizeUploadText(text);
console.log(normalized.split('\n').slice(0, 50).join('\n'));
console.log('...\n');

console.log('=== STEP 2: Full pipeline ===');
const parsed = parseResumeText(normalized);
const result = mapParsedResume(parsed);

console.log('Sections:', Object.keys(parsed.sections));
Object.entries(parsed.sections).forEach(([k, v]) => {
  console.log(`  ${k}: ${v.length} lines`);
});

console.log('\nContact:', JSON.stringify(result.contact, null, 2));
console.log('Title:', result.title);
console.log('Summary:', result.summary?.substring(0, 100) + '...');
console.log('Skills (' + result.skills.length + '):', result.skills);
console.log('\nExperience (' + result.experience.length + '):');
result.experience.forEach(e => console.log(`  ${e.role} @ ${e.company} (${e.startDate} - ${e.endDate}) [${e.highlights.length} hl]`));
console.log('\nEducation (' + result.education.length + '):');
result.education.forEach(e => console.log(`  ${e.degree} @ ${e.institution} (${e.startDate} - ${e.endDate})`));
console.log('RoleLevel:', result.roleLevel);
