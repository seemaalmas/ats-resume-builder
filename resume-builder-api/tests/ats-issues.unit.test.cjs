const assert = require('node:assert/strict');
const test = require('node:test');
const { ResumeService } = require('../dist/resume/resume.service.js');
const { SettingsService } = require('../dist/settings/settings.service.js');

function createPrisma(paymentFeatureEnabled = false, firstHighlight = 'Led 2 engineers to automate deployments.') {
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
      title: 'ATS Test Resume',
      contact: { fullName: 'Free User' },
      summary: 'Engineer driving automation and reliability.',
      skills: ['Node.js', 'TypeScript', 'NestJS', 'AWS', 'CI/CD'],
      experience: [
        {
          company: 'Acme',
          role: 'Platform Engineer',
          startDate: '2020-01',
          endDate: '2023-12',
          highlights: [firstHighlight],
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
      projects: [],
      certifications: [],
    },
    appSetting: {
      id: 'app-settings',
      rateLimitEnabled: true,
      paymentFeatureEnabled,
      updatedAt: new Date(),
    },
  };

  return {
    user: {
      findUnique: async ({ where }) => {
        if (where.id === state.user.id) return { ...state.user };
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
        if (where.id === state.appSetting.id) return { ...state.appSetting };
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
  };
}

test('job description suggestion is informational when no job description provided', async () => {
  const prisma = createPrisma(false);
  const settingsService = new SettingsService(prisma);
  await settingsService.ensureDefaults();
  const resumeService = new ResumeService(prisma, settingsService);

  const result = await resumeService.atsScoreForResume('user-1', 'resume-1');
  assert.equal(result.meta.jobDescriptionUsed, false);
  const jdIssue = result.issues.find((issue) => issue.code === 'JD_SUGGESTION');
  assert.ok(jdIssue);
  assert.equal(jdIssue.severity, 'info');
  assert.equal(jdIssue.section, 'jobDescription');
});

test('action verb issues include stable pointers', async () => {
  const prisma = createPrisma(false, 'Responsible for automating platform releases.');
  const settingsService = new SettingsService(prisma);
  await settingsService.ensureDefaults();
  const resumeService = new ResumeService(prisma, settingsService);

  const atsResult = await resumeService.atsScoreForResume('user-1', 'resume-1', 'Platform engineer responsible for automation.');
  assert.equal(atsResult.meta.jobDescriptionUsed, true);
  const actionIssue = atsResult.issues.find((issue) => issue.code === 'EXP_BULLET_ACTION_VERB');
  assert.ok(actionIssue);
  assert.equal(actionIssue.section, 'experience');
  assert.ok(actionIssue.pointer?.bulletId);
});


test('score does not default to 100 when JD is missing', async () => {
  const prisma = createPrisma(false, 'Responsible for automating platform releases.');
  const settingsService = new SettingsService(prisma);
  await settingsService.ensureDefaults();
  const resumeService = new ResumeService(prisma, settingsService);

  const result = await resumeService.atsScoreForResume('user-1', 'resume-1');
  assert.equal(result.meta.jobDescriptionUsed, false);
  assert.ok(result.atsScore < 100, 'ATS score should reflect resume-only performance');
  const infoIssue = result.issues.find((issue) => issue.code === 'JD_SUGGESTION');
  assert.ok(infoIssue);
  assert.equal(infoIssue.severity, 'info');
});
