const assert = require('node:assert/strict');
const test = require('node:test');
const puppeteer = require('puppeteer');
const { ResumeService } = require('../dist/resume/resume.service.js');

function createInMemoryPrisma(templateId = 'modern') {
  const state = {
    user: {
      id: 'user-1',
      plan: 'PRO',
      atsScansUsed: 0,
      atsScansLimit: 300,
      pdfExportsUsed: 0,
      pdfExportsLimit: 200,
      resumesLimit: 100,
      aiTokensUsed: 0,
      aiTokensLimit: 120000,
      usagePeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      usagePeriodEnd: new Date('2099-01-01T00:00:00.000Z'),
      stripeCurrentPeriodEnd: null,
    },
    resume: {
      id: 'resume-1',
      userId: 'user-1',
      title: 'Principal Engineer Resume',
      templateId,
      contact: {
        fullName: 'Jane Export',
        email: 'jane.export@example.com',
        phone: '9999999999',
        location: 'Pune, IN',
      },
      summary: 'Technical Lead with 11 years of experience delivering frontend-heavy enterprise applications.',
      skills: ['React', 'TypeScript', 'Node.js', 'AWS', 'CI/CD', 'Redis'],
      experience: [
        {
          company: 'Acme Corp',
          role: 'Engineering Lead',
          startDate: '2021-01',
          endDate: 'Present',
          highlights: [
            'Built reusable template rendering pipelines for resume exports.',
            'Improved release speed by 40 percent with automated CI workflows.',
          ],
        },
      ],
      education: [
        {
          institution: 'State University',
          degree: 'B.Tech',
          startDate: '2010-01',
          endDate: '2014-01',
          details: ['Graduated with distinction'],
        },
      ],
      projects: [
        {
          name: 'Resume Export Service',
          role: 'Owner',
          startDate: '2025-01',
          endDate: '2026-01',
          highlights: ['Implemented template-aware server-side PDF generation'],
        },
      ],
      certifications: [
        {
          name: 'AWS Solutions Architect',
          issuer: 'Amazon',
          date: '2024-05',
          details: ['Professional'],
        },
      ],
    },
  };

  return {
    user: {
      findUnique: async ({ where }) => (where.id === state.user.id ? { ...state.user } : null),
      update: async ({ where, data }) => {
        if (where.id !== state.user.id) throw new Error('user not found');
        state.user = { ...state.user, ...data };
        return { ...state.user };
      },
    },
    resume: {
      findFirst: async ({ where }) => {
        if (where.id === state.resume.id && where.userId === state.resume.userId) {
          return { ...state.resume };
        }
        return null;
      },
      update: async ({ where, data }) => {
        if (where.id !== state.resume.id) throw new Error('resume not found');
        state.resume = { ...state.resume, ...data };
        return { ...state.resume };
      },
    },
    __getState: () => state,
  };
}

async function withCapturedPdfHtml(run) {
  let capturedHtml = '';
  const originalLaunch = puppeteer.launch;
  const originalDefaultLaunch = puppeteer.default?.launch;
  const mockLaunch = async () => ({
    newPage: async () => ({
      setContent: async (html) => {
        capturedHtml = String(html || '');
      },
      pdf: async () => Buffer.from(capturedHtml, 'utf8'),
    }),
    close: async () => {},
  });
  puppeteer.launch = mockLaunch;
  if (puppeteer.default) {
    puppeteer.default.launch = mockLaunch;
  }
  try {
    await run(() => capturedHtml);
  } finally {
    puppeteer.launch = originalLaunch;
    if (puppeteer.default && originalDefaultLaunch) {
      puppeteer.default.launch = originalDefaultLaunch;
    }
  }
}

test('generatePdf uses selected template markup and includes user resume data', async () => {
  const prisma = createInMemoryPrisma('modern');
  const service = new ResumeService(prisma, {
    isPaymentFeatureEnabled: async () => false,
    isRateLimitEnabled: async () => false,
  });

  await withCapturedPdfHtml(async () => {
    const pdfBuffer = await service.generatePdf('user-1', 'resume-1');
    assert.ok(Buffer.isBuffer(pdfBuffer));
    const rendered = pdfBuffer.toString('utf8');
    assert.match(rendered, /Principal Engineer Resume/);
    assert.match(rendered, /jane\.export@example\.com/);
    assert.match(rendered, /data-template-id="modern"/);
    assert.match(rendered, /data-render-context="export"/);
    assert.match(rendered, /TEMPLATE_FINGERPRINT:modern/);
    assert.match(rendered, /Engineering Lead \| Acme Corp/);
    assert.match(rendered, /Jan 2021 - Present/);
    assert.equal(prisma.__getState().user.pdfExportsUsed, 1);
  });
});

test('export CSS does not force whole sections to next page', async () => {
  const prisma = createInMemoryPrisma('executive');
  const service = new ResumeService(prisma, {
    isPaymentFeatureEnabled: async () => false,
    isRateLimitEnabled: async () => false,
  });

  const rendered = await service.debugExportHtml('user-1', 'resume-1');
  assert.doesNotMatch(rendered.html, /\.ats-section\s*\{[^}]*page-break-inside:\s*avoid;/i);
  assert.match(rendered.html, /\.ats-item\s*\{[^}]*page-break-inside:\s*avoid;/i);
  assert.match(rendered.html, /overflow-wrap:\s*anywhere/i);
  assert.match(rendered.html, /word-break:\s*break-word/i);
  assert.doesNotMatch(rendered.html, /\.ats-template\s*\{[^}]*display:\s*grid/i);
  assert.doesNotMatch(rendered.html, /\.ats-template\s*\{[^}]*columns\s*:/i);
});

test('apply template update persists and export uses the persisted templateId', async () => {
  const prisma = createInMemoryPrisma('classic');
  const service = new ResumeService(prisma, {
    isPaymentFeatureEnabled: async () => false,
    isRateLimitEnabled: async () => false,
  });

  await service.update('user-1', 'resume-1', { templateId: 'modern' });
  assert.equal(prisma.__getState().resume.templateId, 'modern');

  await withCapturedPdfHtml(async () => {
    const pdfBuffer = await service.generatePdf('user-1', 'resume-1');
    const rendered = pdfBuffer.toString('utf8');
    assert.match(rendered, /data-template-id="modern"/);
    assert.match(rendered, /TEMPLATE_FINGERPRINT:modern/);
    assert.match(rendered, /class="ats-template ats-template--modern"/);
  });
});

test('export does not fall back to classic when resume.templateId is set', async () => {
  const prisma = createInMemoryPrisma('executive');
  const service = new ResumeService(prisma, {
    isPaymentFeatureEnabled: async () => false,
    isRateLimitEnabled: async () => false,
  });

  await withCapturedPdfHtml(async () => {
    const pdfBuffer = await service.generatePdf('user-1', 'resume-1');
    const rendered = pdfBuffer.toString('utf8');
    assert.match(rendered, /data-template-id="executive"/);
    assert.match(rendered, /TEMPLATE_FINGERPRINT:executive/);
    assert.doesNotMatch(rendered, /TEMPLATE_FINGERPRINT:classic/);
    assert.doesNotMatch(rendered, /Impact:\s/);
  });
});

test('executive export uses ATS section names instead of marketing labels', async () => {
  const prisma = createInMemoryPrisma('executive');
  const service = new ResumeService(prisma, {
    isPaymentFeatureEnabled: async () => false,
    isRateLimitEnabled: async () => false,
  });

  const rendered = await service.debugExportHtml('user-1', 'resume-1');
  assert.match(rendered.html, /<h2 class="ats-upper">SUMMARY<\/h2>/);
  assert.match(rendered.html, /<h2 class="ats-upper">SKILLS<\/h2>/);
  assert.match(rendered.html, /<h2 class="ats-upper">EXPERIENCE<\/h2>/);
  assert.doesNotMatch(rendered.html, /EXECUTIVE SUMMARY/i);
  assert.doesNotMatch(rendered.html, /CORE CAPABILITIES/i);
  assert.doesNotMatch(rendered.html, /PROFESSIONAL IMPACT/i);
});

test('switching template changes exported renderer output markers', async () => {
  const prisma = createInMemoryPrisma('modern');
  const service = new ResumeService(prisma, {
    isPaymentFeatureEnabled: async () => false,
    isRateLimitEnabled: async () => false,
  });

  await withCapturedPdfHtml(async () => {
    const pdfBuffer = await service.generatePdf('user-1', 'resume-1');
    const rendered = pdfBuffer.toString('utf8');
    assert.match(rendered, /TEMPLATE_FINGERPRINT:modern/);
    assert.match(rendered, /<h2>Summary<\/h2>/);
  });

  await service.update('user-1', 'resume-1', { templateId: 'graduate' });

  await withCapturedPdfHtml(async () => {
    const pdfBuffer = await service.generatePdf('user-1', 'resume-1');
    const rendered = pdfBuffer.toString('utf8');
    assert.match(rendered, /TEMPLATE_FINGERPRINT:graduate/);
    assert.match(rendered, /<h2>Projects<\/h2>/);
    assert.ok(rendered.indexOf('<h2>Experience</h2>') < rendered.indexOf('<h2>Projects</h2>'));
  });
});

test('export uses explicit template override before persisted templateId', async () => {
  const prisma = createInMemoryPrisma('classic');
  const service = new ResumeService(prisma, {
    isPaymentFeatureEnabled: async () => false,
    isRateLimitEnabled: async () => false,
  });

  await withCapturedPdfHtml(async () => {
    const pdfBuffer = await service.generatePdf('user-1', 'resume-1', 'technical');
    const rendered = pdfBuffer.toString('utf8');
    assert.match(rendered, /data-template-id="technical"/);
    assert.match(rendered, /TEMPLATE_FINGERPRINT:technical/);
    assert.doesNotMatch(rendered, /TEMPLATE_FINGERPRINT:classic/);
  });
});

test('debugExportHtml returns fingerprint and css bundle markers for persisted template', async () => {
  const prisma = createInMemoryPrisma('executive');
  const service = new ResumeService(prisma, {
    isPaymentFeatureEnabled: async () => false,
    isRateLimitEnabled: async () => false,
  });

  const rendered = await service.debugExportHtml('user-1', 'resume-1');
  assert.equal(rendered.templateId, 'executive');
  assert.match(rendered.fingerprint, /TEMPLATE_FINGERPRINT:executive/);
  assert.match(rendered.cssBundle, /inline:ats-template-css-v1/);
  assert.match(rendered.html, /data-template-id="executive"/);
  assert.match(rendered.html, /data-css-bundle="inline:ats-template-css-v1"/);
});

test('debugExportHtml fingerprint changes when template switches from executive to classic', async () => {
  const prisma = createInMemoryPrisma('executive');
  const service = new ResumeService(prisma, {
    isPaymentFeatureEnabled: async () => false,
    isRateLimitEnabled: async () => false,
  });

  const before = await service.debugExportHtml('user-1', 'resume-1');
  assert.match(before.html, /TEMPLATE_FINGERPRINT:executive/);
  assert.match(before.html, /data-template-id="executive"/);

  await service.update('user-1', 'resume-1', { templateId: 'classic' });

  const after = await service.debugExportHtml('user-1', 'resume-1');
  assert.match(after.html, /TEMPLATE_FINGERPRINT:classic/);
  assert.match(after.html, /data-template-id="classic"/);
  assert.notEqual(before.fingerprint, after.fingerprint);
});
