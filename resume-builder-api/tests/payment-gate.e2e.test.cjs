const assert = require('node:assert/strict');
const test = require('node:test');
const puppeteer = require('puppeteer');
const { ResumeService } = require('../dist/resume/resume.service.js');
const { SettingsService } = require('../dist/settings/settings.service.js');

const APP_SETTING_ID = 'app-settings';

function createInMemoryPrisma(paymentFeatureEnabled = false) {
  const state = {
    user: {
      id: 'user-1',
      plan: 'FREE',
    atsScansUsed: 0,
    atsScansLimit: 2,
      pdfExportsUsed: 0,
    pdfExportsLimit: 5,
      resumesLimit: 5,
      aiTokensUsed: 0,
      aiTokensLimit: 8000,
      usagePeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      usagePeriodEnd: new Date('2099-01-01T00:00:00.000Z'),
      stripeCurrentPeriodEnd: null,
    },
    resume: {
      id: 'resume-1',
      userId: 'user-1',
      title: 'Payment Gate Resume',
      contact: { fullName: 'Free User' },
    summary: 'Platform engineer delivering automation, reliability, and data-rich insights for distributed systems.',
    skills: ['Node.js', 'TypeScript', 'NestJS', 'AWS', 'GraphQL', 'CI/CD', 'Observability'],
    experience: [
      {
        company: 'Acme Corp',
        role: 'Platform Engineer',
        startDate: '2020-01',
        endDate: '2023-12',
        highlights: ['Led 2 engineers and improved reliability by 30%.'],
      },
      {
        company: 'Zephyr Labs',
        role: 'Senior Developer',
        startDate: '2018-01',
        endDate: '2019-12',
        highlights: ['Reduced deployment time by 60% with automated pipelines.', 'Built telemetry for 99.9% uptime monitoring.'],
      },
    ],
    education: [
      {
        institution: 'State University',
        degree: 'B.Tech Computer Science',
        startDate: '2014-01',
        endDate: '2018-01',
        details: ['Graduated with honors'],
      },
    ],
    projects: [
      {
        name: 'Release Automation Platform',
        role: 'Lead Engineer',
        startDate: '2021-06',
        endDate: '2023-01',
        highlights: ['Automated release notes and approval flows.', 'Enabled metrics-driven quality gates.'],
      },
    ],
    certifications: [
      {
        name: 'AWS Solutions Architect',
        issuer: 'Amazon',
        date: '2022-05',
        details: ['Validated cloud architecture and security best practices'],
      },
    ],
    },
    appSetting: {
      id: APP_SETTING_ID,
      rateLimitEnabled: true,
      paymentFeatureEnabled,
      updatedAt: new Date(),
    },
  };

  return {
    user: {
      findUnique: async ({ where }) => {
        if (where.id === state.user.id) return { ...state.user };
        if (where.email && where.email === 'user@example.com') return { ...state.user };
        return null;
      },
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
    },
    appSetting: {
      findUnique: async ({ where }) => {
        if (state.appSetting.id === where.id) {
          return { ...state.appSetting };
        }
        return null;
      },
      upsert: async ({ where, update, create }) => {
        if (!state.appSetting || state.appSetting.id !== where.id) {
          state.appSetting = {
            id: create.id,
            rateLimitEnabled: create.rateLimitEnabled,
            paymentFeatureEnabled: create.paymentFeatureEnabled ?? false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          return { ...state.appSetting };
        }
        state.appSetting = {
          ...state.appSetting,
          ...(update || {}),
          updatedAt: new Date(),
        };
        return { ...state.appSetting };
      },
    },
    __getState: () => state,
  };
}

test('free user can access ATS and PDF when payment gate disabled', async () => {
  const prisma = createInMemoryPrisma(false);
  const settingsService = new SettingsService(prisma);
  await settingsService.ensureDefaults();
  const resumeService = new ResumeService(prisma, settingsService);

  const dummyBuffer = Buffer.from('pdf-bytes');
  const originalLaunch = puppeteer.launch;
  const originalDefaultLaunch = puppeteer.default?.launch;
  const mockLaunch = async () => ({
    newPage: async () => ({
      setContent: async () => {},
      pdf: async () => dummyBuffer,
    }),
    close: async () => {},
  });
  puppeteer.launch = mockLaunch;
  if (puppeteer.default) {
    puppeteer.default.launch = mockLaunch;
  }

  try {
    for (let i = 0; i < 3; i += 1) {
      const atsResult = await resumeService.atsScoreForResume('user-1', 'resume-1');
      assert.equal(typeof atsResult.atsScore, 'number');
    }

    try {
      const pdf = await resumeService.generatePdf('user-1', 'resume-1');
      assert.ok(Buffer.isBuffer(pdf));
      assert.equal(pdf.toString('utf8'), dummyBuffer.toString('utf8'));
    } catch (error) {
      assert.ok(
        error instanceof Error,
        'expected PDF generation to either succeed or fail for reasons other than gating',
      );
      assert.notEqual(
        String(error.message),
        'Free plan does not allow PDF export.',
        'unexpected ForbiddenException when payment feature disabled',
      );
    }
  } finally {
    puppeteer.launch = originalLaunch;
    if (puppeteer.default && originalDefaultLaunch) {
      puppeteer.default.launch = originalDefaultLaunch;
    }
  }
});

test('stored payment flag does not block ATS or PDF while non-billing mode is active', async () => {
  const prisma = createInMemoryPrisma(false);
  const settingsService = new SettingsService(prisma);
  await settingsService.ensureDefaults();
  await settingsService.setPaymentFeatureEnabled(true);
  const resumeService = new ResumeService(prisma, settingsService);

  const dummyBuffer = Buffer.from('pdf-bytes');
  const originalLaunch = puppeteer.launch;
  const originalDefaultLaunch = puppeteer.default?.launch;
  const mockLaunch = async () => ({
    newPage: async () => ({
      setContent: async () => {},
      pdf: async () => dummyBuffer,
    }),
    close: async () => {},
  });
  puppeteer.launch = mockLaunch;
  if (puppeteer.default) {
    puppeteer.default.launch = mockLaunch;
  }

  try {
    for (let i = 0; i < 3; i += 1) {
      const atsResult = await resumeService.atsScoreForResume('user-1', 'resume-1');
      assert.equal(typeof atsResult.atsScore, 'number');
    }

    const pdf = await resumeService.generatePdf('user-1', 'resume-1');
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.toString('utf8'), dummyBuffer.toString('utf8'));
  } finally {
    puppeteer.launch = originalLaunch;
    if (puppeteer.default && originalDefaultLaunch) {
      puppeteer.default.launch = originalDefaultLaunch;
    }
  }
});
