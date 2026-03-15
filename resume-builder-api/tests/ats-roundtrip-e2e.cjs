/**
 * Generate an ATS PDF using the actual template renderer + Puppeteer,
 * then extract text with pdf-parse, and print the extracted text.
 */
const puppeteer = require('puppeteer-core');
const { PDFParse } = require('pdf-parse');
const { renderResumeTemplateHtml } = require('../dist/resume/resume.service');
const { parseResumeText, mapParsedResume } = require('resume-intelligence');
const fs = require('fs');

async function main() {
  const resume = {
    title: 'AVP - Full Stack Engineer, Citi Corp',
    contact: {
      fullName: 'Chandan Kumar',
      email: 'cks011992@gmail.com',
      phone: '+91-9307003382',
      location: 'Pune, MH 411057',
      links: ['https://www.linkedin.com/in/chandankumar007'],
    },
    summary: '10+ years of experience in the IT industry with expertise in full-stack development, agile planning, and driving innovation across enterprise platforms.',
    skills: ['JavaScript', 'React', 'Node.js', 'TypeScript', 'Angular', 'HTML', 'CSS', 'AWS', 'Docker', 'Git', 'Agile methodologies', 'CI/CD', 'MongoDB', 'PostgreSQL', 'Redis', 'Microservices', 'GraphQL', 'Kubernetes'],
    experience: [
      {
        role: 'AVP - Full Stack Engineer',
        company: 'Citi Corp',
        startDate: '2022-12',
        endDate: 'Present',
        highlights: [
          'Led cross-functional teams to deliver enterprise-grade applications',
          'Architected scalable microservices using Node.js and React',
          'Improved release quality through CI guardrails',
        ],
      },
      {
        role: 'Senior Technology Consultant',
        company: 'Ernst & Young',
        startDate: '2021-10',
        endDate: '2022-12',
        highlights: [
          'Engineered reusable template architecture for resume exports',
          'Reduced frontend effort by 60% across teams',
        ],
      },
      {
        role: 'Senior Software Developer',
        company: 'One Network Enterprises',
        startDate: '2020-09',
        endDate: '2021-09',
        highlights: [
          'Managed complete development lifecycle from UX planning to deployment',
          'Improved production reliability with better observability',
        ],
      },
      {
        role: 'Lead UI Developer',
        company: 'Infosys Ltd',
        startDate: '2014-07',
        endDate: '2020-08',
        highlights: [
          'Directed end-to-end UI delivery for FINACLE',
          'Standardized coding patterns for maintainability',
        ],
      },
    ],
    education: [
      { degree: 'Master of Computer Applications', institution: 'Savitribai Phule Pune University', startDate: '2012-01', endDate: '2014-01' },
      { degree: 'Bachelor of Computer Applications', institution: 'University of Pune', startDate: '2009-01', endDate: '2012-01' },
    ],
    certifications: [{ name: 'AWS Certified Solutions Architect', issuer: 'Amazon Web Services', date: '2023-01' }],
    templateId: 'classic',
  };

  // Step 1: Generate HTML from ATS template
  const { html } = renderResumeTemplateHtml(resume, 'classic');
  fs.writeFileSync('/tmp/ats-roundtrip.html', html, 'utf8');
  console.log('=== STEP 1: HTML generated ===\n');

  // Step 2: Render HTML to PDF using Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const pdfBuffer = await page.pdf({
    format: 'A4',
    margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
    printBackground: true,
  });
  await browser.close();

  fs.writeFileSync('/tmp/ats-roundtrip.pdf', pdfBuffer);
  console.log(`=== STEP 2: PDF generated (${pdfBuffer.length} bytes) ===\n`);

  // Step 3: Extract text from PDF using pdf-parse (same as the API does)
  const parser = new PDFParse({ data: pdfBuffer });
  const parsed = await parser.getText();
  const extractedText = parsed.text || '';
  await parser.destroy();

  fs.writeFileSync('/tmp/ats-roundtrip-extracted.txt', extractedText, 'utf8');
  console.log('=== STEP 3: Extracted text from PDF ===');
  console.log(extractedText);
  console.log('\n=== END OF EXTRACTED TEXT ===\n');

  // Step 4: Run through the parsing pipeline (intelligence package only)
  const parsedResume = parseResumeText(extractedText);
  console.log('=== STEP 4: Sections detected ===');
  for (const [section, lines] of Object.entries(parsedResume.sections)) {
    console.log(`  ${section}: ${lines.length} lines`);
  }

  const mapped = mapParsedResume(parsedResume);
  console.log('\n=== STEP 5: Mapped result ===');
  console.log(`  Title: "${mapped.title}"`);
  console.log(`  Contact: ${JSON.stringify(mapped.contact)}`);
  console.log(`  Summary: "${mapped.summary?.substring(0, 80)}..."`);
  console.log(`  Skills: ${mapped.skills?.length} items`);
  console.log(`  Experience: ${mapped.experience?.length} entries`);
  for (const exp of mapped.experience || []) {
    console.log(`    - ${exp.role} @ ${exp.company} (${exp.startDate} - ${exp.endDate}) [${exp.highlights?.length} highlights]`);
  }
  console.log(`  Education: ${mapped.education?.length} entries`);
  for (const edu of mapped.education || []) {
    console.log(`    - ${edu.degree} @ ${edu.institution}`);
  }
  console.log(`  Certifications: ${mapped.certifications?.length} entries`);
  console.log(`  Role Level: ${mapped.roleLevel}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
