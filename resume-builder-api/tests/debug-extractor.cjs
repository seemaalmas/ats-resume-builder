const { extractExperienceFromText } = require('../dist/resume/resume.service.js');

const text = `EXPERIENCE
AVP, Citi Corp
Dec 2022 - Present
Led teams
Built systems

Senior Software Developer, One Network Enterprises
Sep 2020 - Sep 2021
Developed apps

EDUCATION
B.S. CS
Stanford
2011 - 2015`;

console.log('Test 1 - simple experience text:');
const result1 = extractExperienceFromText(text);
console.log('  Entries:', result1.length);
for (const e of result1) console.log(`  ${e.role || '(no role)'} @ ${e.company || '(no company)'} (${e.startDate}-${e.endDate}) [${e.highlights?.length} hl]`);

// Test with pipe format
const text2 = `EXPERIENCE
Senior Platform Engineer | CloudScale Inc
Jan 2021 - Present
Built auto-scaling platform

Backend Engineer | DataFlow Systems
Mar 2018 - Dec 2020
Designed event-driven architecture

EDUCATION
B.S. CS`;

console.log('\nTest 2 - pipe format:');
const result2 = extractExperienceFromText(text2);
console.log('  Entries:', result2.length);
for (const e of result2) console.log(`  ${e.role || '(no role)'} @ ${e.company || '(no company)'} (${e.startDate}-${e.endDate})`);

// Test with multi-line DOCX format
const text3 = `PROFESSIONAL EXPERIENCE

Assistant Vice President -
12/2022 to Current

CITI PUNE

- Working with Product owner
- Guide team members

Senior Technology Consultant -
10/2021 to 12/2022

Ernst & Young, Pune

- Discussion with client
- Implemented the UI functionality

EDUCATION
B.E.`;

console.log('\nTest 3 - DOCX multi-line format:');
const result3 = extractExperienceFromText(text3);
console.log('  Entries:', result3.length);
for (const e of result3) console.log(`  ${e.role || '(no role)'} @ ${e.company || '(no company)'} (${e.startDate}-${e.endDate}) [${e.highlights?.length} hl]`);
