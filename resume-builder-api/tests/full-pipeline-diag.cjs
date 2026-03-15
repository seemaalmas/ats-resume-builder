/**
 * Diagnostic: tests the full API service pipeline (normalizeUploadText → parseResumeText → mapParsedResume → sanitize → finalize → normalize).
 */
const assert = require('node:assert/strict');

// Load from compiled dist - this is what the API server actually uses
const service = require('../dist/resume/resume.service.js');

// These functions are exported from resume.service.ts
const { finalizeExperience, extractExperienceFromText } = service;

// The resume-intelligence functions used by the service
const ri = require('../../packages/resume-intelligence/dist/index.js');
const { parseResumeText, mapParsedResume, normalizeText } = ri;

// The import sanitizer
const { sanitizeImportedResume } = require('../dist/resume/import-sanitizer.js');

// ============================================================================
// Resume 2: ATS PDF text (exact text from API response)
// ============================================================================
const atsPdfText = `Tech Lead / AVP - Full Stack Engineering / Frontend Strategist
cks011992@gmail.com | 9307003382 | Pune, MH 411057 | https://www.linkedin.com/in/chandankumar007

SUMMARY
- 10+ years of experience in the IT industry with a strong track record of delivering high-ROI software solutions for enterprise clients
in the nancial sector. - Hands-on expertise in ReactJS, Redux, NodeJS, MongoDB, PolymerJS, and full-stack architecture - used to
modernize legacy platforms and increase performance by up to 35%. - Led cross-functional teams of 10+ developers across
multiple geogr

SKILLS
Agile methodologies, agile planning, driving innovation

EXPERIENCE
AVP, Citi Corp
Dec 2022 - Present
Leading cross-functional teams (10+ members) to deliver enterprise-grade applications while driving customer-centric
innovation
Led a team of 10+ engineers to deliver high-performance frontend modules using ReactJS and NodeJS, improving system
Partnered with Product Owners to redene UI workows, enhancing usability and customer satisfaction
Championed code reviews, architecture discussions, and cross-team syncs to align project delivery across verticals
Delivered consistent Agile sprint results and helped reduce release cycle time by 25%
Spearheaded a UI/UX modernization initiative that increased engagement and system adoption across multiple departments
Reduced post-deployment defects to <2% through proactive testing, reusable component libraries, and dev mentorship
Recognized by leadership for driving a culture of ownership, collaboration, and engineering excellence
Senior Software Developer, One Network Enterprises
Sep 2020 - Sep 2021
Led end-to-end UX implementation and frontend architecture using ReactJS, while mentoring the development team and
driving
Managed complete development lifecycle from UX planning to deployment, enhancing platform usability and client satisfaction
Designed enterprise-grade UX mockups and visual ows, resulting in a 30% increase in user task completion rate
Authored and maintained version-controlled technical documentation to streamline stakeholder communication and reduce
Delivered data-intensive visual dashboards using ReactJS and D3, enabling clearer decision-making for clients
Developed scalable ReactJS components with reusable architecture, improving dev eciency and reducing rework by 40%
Proposed and implemented UX enhancements that reduced support queries by 25% within two release cycles
Mentored junior developers on frontend architecture and project design patterns, leading to stronger code consistency
Fostered cross-functional collaboration and team cohesion through Agile ceremonies and knowledge-sharing sessions
Delivered award-nominated UX improvements that improved client retention and reduced churn in post-implementation
feedback
Recognized by leadership for improving design-to-development turnaround time by 35% through reusable component libraries
and
Senior Technology Consultant, Ernst & Young
Jan 2010 - Jun 2014
Led UX transformation and enterprise-grade frontend development using React and congurable HTML templates, enabling
Engineered a reusable HTML template system using React & HTML5, reducing frontend development effort by 60% across
Standardized UI best practices across teams, resulting in a 30% decrease in bugs and faster release cycles
Led UX design optimization efforts, increasing end-user engagement by 25% through improved layout and accessibility
Ensured zero-defect UI delivery in client-facing portals by implementing rigorous testing workows

EDUCATION
BB
Indian Institute of Technology Delhi
Jul 2008 - Aug 2012

-- 1 of 1 --`;

console.log('=== Testing with compiled service code ===\n');

// Step 1: Parse & Map (intelligence package)
const parsed = parseResumeText(atsPdfText);
const mapped = mapParsedResume(parsed);
console.log('Step 1 (intelligence): Experience =', mapped.experience.length, 'Education =', mapped.education.length, 'RoleLevel =', mapped.roleLevel);
console.log('  Signals:', JSON.stringify(mapped.signals));

// Step 2: Sanitize (import-sanitizer)
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
console.log('\nStep 2 (sanitize): Experience =', sanitized.experience.length, 'Education =', sanitized.education.length);
console.log('  Rejected blocks:', sanitized.rejectedBlocks.length);
if (sanitized.rejectedBlocks.length) {
  for (const block of sanitized.rejectedBlocks) {
    console.log('    REJECTED:', block.slice(0, 120));
  }
}

// Step 3: Finalize experience
const dateMatches = atsPdfText.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}|\d{4}/gi) || [];
console.log('\nStep 3 (finalize): dateMatches =', dateMatches.length);
try {
  const finalized = finalizeExperience({
    experience: sanitized.experience,
    parsed,
    fullText: atsPdfText,
    dateMatches: [...new Set(dateMatches.map(d => d.trim()))],
  });
  console.log('  After finalize: Experience =', finalized.length);
  for (const exp of finalized) {
    console.log(`    ${exp.role} @ ${exp.company} (${exp.startDate} - ${exp.endDate}) [${exp.highlights?.length || 0} highlights]`);
  }
} catch (e) {
  console.log('  finalizeExperience not exported or error:', e.message);
  console.log('  Using sanitized experience directly');
}

// Step 4: Check what extractExperienceFromText does (the service's own extractor)
try {
  const serviceExtracted = extractExperienceFromText(atsPdfText, parsed);
  console.log('\nStep 4 (service extractor): Experience =', serviceExtracted.length);
  for (const exp of serviceExtracted) {
    console.log(`    ${exp.role} @ ${exp.company} (${exp.startDate} - ${exp.endDate}) [${exp.highlights?.length || 0} highlights]`);
  }
} catch (e) {
  console.log('\nStep 4 (service extractor) not exported:', e.message);
}

// Print final summary
console.log('\n=== Summary ===');
console.log('Intelligence package: OK (' + mapped.experience.length + ' experience, ' + mapped.education.length + ' education)');
console.log('After sanitize: ' + sanitized.experience.length + ' experience, ' + sanitized.education.length + ' education');
console.log('Rejected:', sanitized.rejectedBlocks.length, 'blocks');
