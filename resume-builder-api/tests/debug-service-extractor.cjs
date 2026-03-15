/**
 * Debug the service-level extractExperienceFromText function
 */
const { extractExperienceFromText, finalizeExperience } = require('../dist/resume/resume.service.js');
const { parseResumeText, mapParsedResume } = require('../../packages/resume-intelligence/dist/index.js');
const { sanitizeImportedResume } = require('../dist/resume/import-sanitizer.js');

// DOCX Resume text (from user's API response text field)
const docxText = `CHANDAN KUMAR
MOBILE:
+91 9307003382
E-mail: CKS011992@gmail.com
ADDRESS:
Wagholi, Pune - 411057

AZ-900 certified, Creative and Solution-focused Professional

UI Developer | Full Stack Developer | Team Management |Team Lead | Agile Development methodologies

PROFILE SUMMARY

Associate Vice President specializing in front end and Back End development.

Experienced with all stages of the development cycle for dynamic web projects. Well-versed in numerous programming languages including HTML5, CSS3, JavaScript, ReactJS, Redux, NodeJS, MongoDB, Polymer JS. Strong background in project management and customer relation. Handled team with more than 10 people. Excellent reputation for resolving problems, improving customer satisfaction, and driving overall operational improvements. Detail-oriented software development professional and team leader with history of proposing enhancements that improve designs. Highly effective at analyzing existing systems to discover issues and developing creative solutions that satisfy business and customer needs.

KEY SKILL

- Strong decision maker
- Complex problem solver
- Creative design
- Service-focused
- Team Lead
- Team Management
- Agile Development Methodology
- Innovative
- Technical Analysis
- Qiuck Learner
- HTML5 & CSS3
- Javascript
- ReactJS/Redux/Mobx
- NodeJS
- PolymerJS
- AngularJS
- MongoDB
- AJAX
- GIT
- NextJS

CERTIFICATIONS

- AZ-900

ACCOMPLISHMENTS

- Collaborated with team of 10 in the development of Speedboat Project (Finacle)
- On-time delivery of almost all the assigned modules with minimum defects.
- Two-time Insta award winner and awarded with a badge "Rising Star"
PROFESSIONAL EXPERIENCE

Assistant Vice President -
12/2022 to Current

CITI PUNE

- Working with Product owner for requirement gathering, responsible for creating UI on the basis of requirement by using configurations
- Guide team members for the assigned tasks
Technologies- HTML, CSS, JavaScript, ReactJS

Senior Technology Consultant -
10/2021 to 12/2022

Ernst & Young, Pune

- Discussion with client on requirements, suggested the required change.
- Implemented the UI functionality with Zero defects by meeting the client requirements.
- Developed team communications and information for meetings.
- Carried out day-to-day duties accurately and efficiently.
- Actively listened to customers' requests, confirming full understanding before addressing concerns.
- Participated in team-building activities to enhance working relationships.
Technologies: HTML, CSS, JavaScript, ReactJS, Mobx, Redux, Hooks, NextJS

Senior Software Developer -
9/2021 to 9/2020

One Network Enterprises, Pune

- Working as Senior software developer on Supply Chain domain product
- Accomplished UX design principles in less time
Technologies - HTML, CSS, JavaScript, React, Redux, Mobx, SQL(Basics)

Lead UI Developer-
06/2018 - 08/2020

Infosys Ltd, Pune

- Worked as Lead UI developer on FINACLE product
Technologies - HTML, CSS, JavaScript, React, PolymerJS, Redux, NodeJS, Gulp, LoopBackJS, Git

Technical Support / UI Developer- 08/2016 - 05/2017

Infosys Ltd, Pune

- Worked as a Technical Support Executive
Technologies - HTML, CSS, JavaScript, BB Script

Systems Engineer (Full Stack)-
08/2016 - 05/2017

Infosys Ltd, Pune

- Worked as Full Stack developer to enhance existing system.
Technologies - Shell Scripting, Java, Python, SQL

EDUCATION

2010-01 - 2014-01

B.E: Telecommunication Engineering

Siddaganga Institute - Tumkur, KA

2007-01 - 2010-01

ASSOCIATE OF SCIENCE: SCIENCE

EDUCATION

A.N.S.M College - Aurangabad, BR

2006-04 - 2007-01

HIGH SCHOOL DIPLOMA

D.A.V Public School - Patna`;

console.log('=== DOCX Resume Full Pipeline Test ===\n');

// Step 1: Intelligence package
const parsed = parseResumeText(docxText);
const mapped = mapParsedResume(parsed);
console.log('Intelligence:');
console.log('  Experience:', mapped.experience.length);
for (const exp of mapped.experience) {
  console.log(`    ${exp.role} @ ${exp.company} (${exp.startDate} - ${exp.endDate})`);
}
console.log('  Education:', mapped.education.length);
console.log('  Skills:', mapped.skills.length);
console.log('  Summary:', mapped.summary.slice(0, 60) + '...');
console.log('  Title:', mapped.title);
console.log('  RoleLevel:', mapped.roleLevel);

// Step 2: Sanitize
const sanitized = sanitizeImportedResume({
  title: mapped.title,
  contact: mapped.contact,
  summary: mapped.summary,
  skills: mapped.skills,
  experience: mapped.experience,
  education: mapped.education,
  projects: mapped.projects || [],
  certifications: mapped.certifications,
  unmappedText: mapped.unmappedText,
}, { mode: 'upload' });
console.log('\nSanitized:');
console.log('  Experience:', sanitized.experience.length);
console.log('  Education:', sanitized.education.length);
console.log('  Skills:', sanitized.skills.length);
console.log('  Rejected:', sanitized.rejectedBlocks.length);
if (sanitized.rejectedBlocks.length) {
  for (const block of sanitized.rejectedBlocks) {
    console.log('    REJECTED:', block.slice(0, 150));
  }
}

// Step 3: Finalize
const allDateMatches = (docxText.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}|\b\d{1,2}[/-]\d{4}\b|\b\d{4}[-/]\d{1,2}\b|\b\d{4}\b/gi) || []).map(d => d.trim());
const uniqueDates = [...new Set(allDateMatches)];
console.log('\nDate matches:', uniqueDates.length, uniqueDates);

const finalized = finalizeExperience({
  experience: sanitized.experience,
  parsed,
  fullText: docxText,
  dateMatches: uniqueDates,
});
console.log('\nFinalized experience:', finalized.length);
for (const exp of finalized) {
  console.log(`  ${exp.role} @ ${exp.company} (${exp.startDate} - ${exp.endDate})`);
}

// Check if the finalized version is different
if (finalized.length !== sanitized.experience.length) {
  console.log('\n⚠️  finalizeExperience CHANGED the experience entries!');
  console.log('  Before:', sanitized.experience.length, '→ After:', finalized.length);
}

// Step 4: Service extractor
const serviceExtracted = extractExperienceFromText(docxText, parsed);
console.log('\nService extractExperienceFromText:', serviceExtracted.length, 'entries');
for (const exp of serviceExtracted) {
  console.log(`  ${exp.role} @ ${exp.company} (${exp.startDate} - ${exp.endDate}) [${exp.highlights?.length || 0} highlights]`);
}

console.log('\nDone.');
