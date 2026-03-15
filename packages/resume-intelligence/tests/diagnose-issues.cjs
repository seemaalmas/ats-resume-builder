/**
 * Diagnostic script to reproduce the exact parsing issues reported by the user.
 * Run: node tests/diagnose-issues.cjs
 */
const { parseResumeText, mapParsedResume, normalizeText } = require('../dist/index.js');

// ============================================================================
// Resume 1: DOCX resume (Chandan Kumar) - the raw text after extraction
// ============================================================================
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

- Working as Senior software developer on Supply Chain domain product where objective is: Understanding and analyzing user's requirements, creating UX design for given requirement and developing screens as per UX design.
- Accomplished UX design principles in less time and delivered screens designs with expertise to client.
- Analyzing complexity of new requirement and create version document which will keep track of the changes given by client
- Discussion with Manager on requirement and provided best way, by which it can increase user experience. Also provided UX design for charts and count widgets.
- Developing component as per requirement, collating with team on each and every discussion from front to end of development, Grooming new team members on ReactJS components, Mobx and Project overview.
- Maintained Polite and pleasant relationship within team.Understanding functional requirements, Identify and Assign tasks to associates, Code review on daily basis.
Technologies - HTML, CSS, JavaScript, React, Redux, Mobx, SQL(Basics)

Lead UI Developer-
06/2018 - 08/2020

Infosys Ltd, Pune

- Worked as Lead UI developer on FINACLE product where objective is: Understanding and analyzing user's requirements, enhancements and making of new UI as per requirement.
- Analyzing complexity of new requirement and create one pager solution design document which will have number of components, API details and design on high level implementation
- Discussion with PO on requirement and also suggested changes which will increase user experience
- Developing component as per requirement, collating with team on each and every discussion from front to end of development Grooming team members on Polymer.
- Understanding functional requirements, Identify and Assign tasks to associates, Code review on daily basis
- Managed approximately 9 team members and continuously assisting them in technical queries
Technologies - HTML, CSS, JavaScript, React, PolymerJS, Redux, NodeJS, Gulp, LoopBackJS, Git

Technical Support / UI Developer- 08/2016 - 05/2017

Infosys Ltd, Pune

- Worked as a Technical Support Executive where Objective is to deal with clients and solve code related issue and to solve problem by discussing with developer and making them understand requirement given by client.
- To deal with clients and solve request which are pending or getting failed.
- To check component if it's working according to requirement.
- Identifying issues in case of any problem.
- Making shell script to automate some processes.
- Making changes in database according to requirement.
- Understanding the functional requirements of the tool assigning access to the user regarding payment and billing.
- Identify and Assign Tasks to associates.
- Good communication with team.
- Unix Shell Scripting.
- Identifying issue and clearing bridge, if any test case fails at bridge network.
- Working with TOAD and executing queries on database to fetch data in form of XMLs to validate results.
- Worked on QUARTZ scheduler, schedule Jobs and perform testing.
- Monitoring the Queues on Putty for checking the smooth flow of data and XMLs among various linked components.
- Managed 10 members of team
Technologies - HTML, CSS, JavaScript, BB Script

Systems Engineer (Full Stack)-
08/2016 - 05/2017

Infosys Ltd, Pune

- Worked as Full Stack developer to enhance existing system.
- Analyze and develop existing code as per requirement.
- Testing and finding area of modification for various modules.
- Update existing code as per change in requirement.
- To create Data flow diagrams.
- Worked on solving defects and provide solution within specified timelines.
- Documenting each defect with proper solution provided to client.
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

// ============================================================================
// Resume 2: ATS PDF (exported from the application)
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

console.log('=== RESUME 1 (DOCX) ===\n');
const parsed1 = parseResumeText(docxText);
console.log('Sections found:', Object.keys(parsed1.sections));
console.log('Section sizes:', Object.fromEntries(Object.entries(parsed1.sections).map(([k,v]) => [k, v.length])));

const mapped1 = mapParsedResume(parsed1);
console.log('\nTitle:', mapped1.title);
console.log('Summary (first 80 chars):', mapped1.summary.slice(0, 80));
console.log('Skills count:', mapped1.skills.length, '→', mapped1.skills.slice(0, 5));
console.log('Experience count:', mapped1.experience.length);
for (const exp of mapped1.experience) {
  console.log(`  - ${exp.role} @ ${exp.company} (${exp.startDate} - ${exp.endDate}) [${exp.highlights.length} highlights]`);
}
console.log('Education count:', mapped1.education.length);
for (const edu of mapped1.education) {
  console.log(`  - ${edu.degree} @ ${edu.institution} (${edu.startDate} - ${edu.endDate})`);
}
console.log('Certifications count:', mapped1.certifications.length);
for (const cert of mapped1.certifications) {
  console.log(`  - ${cert.name}`);
}
console.log('RoleLevel:', mapped1.roleLevel);
console.log('Signals:', mapped1.signals);

console.log('\n\n=== RESUME 2 (ATS PDF) ===\n');
const parsed2 = parseResumeText(atsPdfText);
console.log('Sections found:', Object.keys(parsed2.sections));
console.log('Section sizes:', Object.fromEntries(Object.entries(parsed2.sections).map(([k,v]) => [k, v.length])));

const mapped2 = mapParsedResume(parsed2);
console.log('\nTitle:', mapped2.title);
console.log('Summary (first 80 chars):', mapped2.summary.slice(0, 80));
console.log('Skills count:', mapped2.skills.length, '→', mapped2.skills);
console.log('Experience count:', mapped2.experience.length);
for (const exp of mapped2.experience) {
  console.log(`  - ${exp.role} @ ${exp.company} (${exp.startDate} - ${exp.endDate}) [${exp.highlights.length} highlights]`);
}
console.log('Education count:', mapped2.education.length);
for (const edu of mapped2.education) {
  console.log(`  - ${edu.degree} @ ${edu.institution} (${edu.startDate} - ${edu.endDate})`);
}
console.log('RoleLevel:', mapped2.roleLevel);
console.log('Signals:', mapped2.signals);

// List any issues
console.log('\n\n=== ISSUES FOUND ===');
const issues = [];
// Resume 1
if (!Object.keys(parsed1.sections).includes('summary')) issues.push('R1: PROFILE SUMMARY not detected as summary section');
if (!Object.keys(parsed1.sections).includes('skills')) issues.push('R1: KEY SKILL not detected as skills section');
if (mapped1.skills.length === 0) issues.push('R1: No skills extracted');
if (mapped1.experience.some(e => /^Technologies/i.test(e.company))) issues.push('R1: "Technologies-..." line treated as company name');
if (mapped1.education.length === 0) issues.push('R1: No education extracted');
if (mapped1.certifications.some(c => c.name === 'ACCOMPLISHMENTS')) issues.push('R1: ACCOMPLISHMENTS leaked into certifications');
// Resume 2
if (mapped2.experience.length === 0) issues.push('R2: No experience extracted from ATS PDF');
if (mapped2.education.length === 0) issues.push('R2: No education extracted from ATS PDF');
if (mapped2.roleLevel === 'FRESHER') issues.push('R2: roleLevel is FRESHER (should be SENIOR)');
if (mapped2.skills.length <= 3) issues.push('R2: Only ' + mapped2.skills.length + ' skills (missing most)');

for (const issue of issues) console.log('  ❌ ' + issue);
if (!issues.length) console.log('  ✅ No issues!');
