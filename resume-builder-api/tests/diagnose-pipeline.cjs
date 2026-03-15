/**
 * Diagnostic: full service pipeline simulation.
 * Pinpoints exactly where the corruption occurs for both resume formats.
 */
const assert = require('node:assert/strict');
const path = require('node:path');

// Import from the compiled API source
// We need to manually require the built files
async function run() {
  const ri = require('../../packages/resume-intelligence/dist/index.js');
  const { parseResumeText, mapParsedResume, normalizeText } = ri;

  // Simulate the full pipeline manually by calling each step

  // ATS PDF Resume text (from user's API response)
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

  console.log('=== Step 1: parseResumeText ===');
  const parsed = parseResumeText(atsPdfText);
  console.log('Sections:', Object.keys(parsed.sections));
  console.log('Experience lines:', parsed.sections.experience?.length || 0);

  console.log('\n=== Step 2: mapParsedResume ===');
  const mapped = mapParsedResume(parsed);
  console.log('Experience:', mapped.experience.length, 'entries');
  for (const exp of mapped.experience) {
    console.log(`  ${exp.role} @ ${exp.company} (${exp.startDate}-${exp.endDate}) [${exp.highlights.length} highlights]`);
  }
  console.log('Education:', mapped.education.length, 'entries');
  for (const edu of mapped.education) {
    console.log(`  ${edu.degree} @ ${edu.institution} (${edu.startDate}-${edu.endDate})`);
  }
  console.log('RoleLevel:', mapped.roleLevel);
  console.log('Signals:', JSON.stringify(mapped.signals));
  console.log('Skills:', mapped.skills);
  console.log('Unmapped text (first 200):', (mapped.unmappedText || '').slice(0, 200));

  // Now simulate sanitizeImportedResume
  console.log('\n=== Step 3: sanitizeImportedResume (simulated) ===');
  // The import sanitizer accepts entries with company >= 2 OR role >= 2 in upload mode
  const sanitizedExperience = mapped.experience.filter(e => {
    const valid = (e.company || '').length >= 2 || (e.role || '').length >= 2;
    if (!valid) console.log('  REJECTED:', e.role, '@', e.company);
    return valid;
  });
  console.log('Experience after sanitize:', sanitizedExperience.length);

  // Simulate normalizeExportDateToken
  function toYearMonthToken(value) {
    const clean = String(value || '').trim().toLowerCase();
    if (!clean) return '';
    if (/present|current|now/i.test(clean)) return 'Present';
    const monthMap = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',sept:'09',oct:'10',nov:'11',dec:'12' };
    const monthYear = clean.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(19\d{2}|20\d{2})$/i);
    if (monthYear) {
      const month = monthMap[monthYear[1].toLowerCase().slice(0,4)] || monthMap[monthYear[1].toLowerCase().slice(0,3)];
      return month ? `${monthYear[2]}-${month}` : '';
    }
    const mmYyyy = clean.match(/^(\d{1,2})[/-](19\d{2}|20\d{2})$/);
    if (mmYyyy) {
      const m = Number(mmYyyy[1]);
      return (m >= 1 && m <= 12) ? `${mmYyyy[2]}-${String(m).padStart(2,'0')}` : '';
    }
    const yyyyMm = clean.match(/^(19\d{2}|20\d{2})[/-](\d{1,2})$/);
    if (yyyyMm) {
      const m = Number(yyyyMm[2]);
      return (m >= 1 && m <= 12) ? `${yyyyMm[1]}-${String(m).padStart(2,'0')}` : '';
    }
    const year = clean.match(/^(19\d{2}|20\d{2})$/);
    if (year) return year[1];
    return '';
  }

  function normalizeExportDateToken(token, allowPresent) {
    const raw = String(token || '').trim();
    if (!raw || /^[-_/.,\s|]+$/.test(raw)) return '';
    if (allowPresent && /^(present|current|now)$/i.test(raw)) return 'Present';
    return toYearMonthToken(raw) || '';
  }

  console.log('\n=== Step 4: normalizeResumeForAtsOutput (simulated) ===');
  for (const exp of sanitizedExperience) {
    const start = normalizeExportDateToken(exp.startDate, false);
    const end = normalizeExportDateToken(exp.endDate, true);
    console.log(`  ${exp.role} @ ${exp.company}: ${exp.startDate} → "${start}", ${exp.endDate} → "${end}"`);
    if (!start && exp.startDate) console.log(`    ⚠️  startDate "${exp.startDate}" was LOST by normalizeExportDateToken!`);
    if (!end && exp.endDate) console.log(`    ⚠️  endDate "${exp.endDate}" was LOST by normalizeExportDateToken!`);
  }

  // Check education
  console.log('\n=== Education pipeline ===');
  for (const edu of mapped.education) {
    const start = normalizeExportDateToken(edu.startDate, false);
    const end = normalizeExportDateToken(edu.endDate, false);
    console.log(`  ${edu.degree} @ ${edu.institution}: ${edu.startDate} → "${start}", ${edu.endDate} → "${end}"`);
    console.log(`  institution.length=${edu.institution.length}, degree.length=${edu.degree.length}`);
    const validInstitution = edu.institution.length >= 2;
    const validDegree = edu.degree.length >= 2;
    if (!validInstitution && !validDegree) console.log('    ⚠️  REJECTED by sanitizeEducation (no valid institution or degree)');
  }

  console.log('\n\nDone.');
}

run().catch(console.error);
