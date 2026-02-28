const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { ResumeController } = require('../dist/resume/resume.controller.js');
const {
  ResumeService,
  RESUME_CREATE_RATE_LIMIT,
  RESUME_CREATE_RATE_LIMIT_CODE,
  RESUME_CREATE_RATE_LIMIT_MESSAGE,
} = require('../dist/resume/resume.service.js');
const { SettingsService } = require('../dist/settings/settings.service.js');
const { PrismaService } = require('../dist/prisma/prisma.service.js');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard.js');

JwtAuthGuard.prototype.canActivate = function canActivate() {
  return true;
};

function buildResumePayload(title) {
  return {
    title,
    contact: {
      fullName: 'Rate Limit User',
      email: 'rate.user@example.com',
      phone: '9000000000',
      location: 'Pune',
      links: ['https://www.linkedin.com/in/rate-limit-user'],
    },
    summary: 'Platform engineer delivering measurable outcomes across distributed systems.',
    skills: ['React', 'Node.js', 'TypeScript'],
    experience: [
      {
        company: 'Acme Corp',
        role: 'Engineer',
        startDate: '2022-01',
        endDate: '2023-12',
        highlights: ['Led release automation and reduced incident load by 30%.'],
      },
    ],
    education: [
      {
        institution: 'State University',
        degree: 'B.E Computer Science',
        startDate: '2016-01',
        endDate: '2020-01',
        details: ['Graduated with honors.'],
      },
    ],
    projects: [],
    certifications: [],
  };
}

const APP_SETTING_ID = 'app-settings';

function createPrisma(userId, options = {}) {
  const state = {
    user: {
      id: userId,
      email: `${userId}@example.com`,
      fullName: 'Rate Limit User',
      passwordHash: 'hash',
      plan: 'PRO',
      resumesLimit: 200,
      atsScansLimit: 200,
      atsScansUsed: 0,
      aiTokensLimit: 100000,
      aiTokensUsed: 0,
      pdfExportsLimit: 100,
      pdfExportsUsed: 0,
      usagePeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      usagePeriodEnd: new Date('2099-01-01T00:00:00.000Z'),
      stripeCurrentPeriodEnd: null,
    },
    resumes: [],
    appSetting: {
      id: APP_SETTING_ID,
      rateLimitEnabled: typeof options.rateLimitEnabled === 'boolean' ? options.rateLimitEnabled : true,
      paymentFeatureEnabled: true,
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    },
  };

  return {
    user: {
      findUnique: async ({ where }) => {
        if (where.id === state.user.id) return { ...state.user };
        if (where.email === state.user.email) return { ...state.user };
        return null;
      },
      update: async ({ where, data }) => {
        if (where.id !== state.user.id) throw new Error('user not found');
        state.user = { ...state.user, ...data };
        return { ...state.user };
      },
    },
    resume: {
      count: async ({ where }) => state.resumes.filter((item) => item.userId === where.userId).length,
      create: async ({ data }) => {
        const created = {
          id: `resume-${state.resumes.length + 1}`,
          userId: data.userId,
          title: data.title,
          contact: data.contact || null,
          skills: Array.isArray(data.skills) ? data.skills : [],
          languages: Array.isArray(data.languages) ? data.languages : [],
          summary: data.summary,
          experience: data.experience,
          education: data.education,
          projects: data.projects || [],
          certifications: data.certifications || [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.resumes.push(created);
        return { ...created };
      },
      findFirst: async () => null,
      findMany: async () => [],
      update: async () => {
        throw new Error('not used in this test');
      },
      delete: async () => {
        throw new Error('not used in this test');
      },
    },
    appSetting: {
      findUnique: async ({ where }) => {
        if (where.id === state.appSetting.id) {
          return { ...state.appSetting };
        }
        return null;
      },
      upsert: async ({ where, create, update }) => {
        if (state.appSetting.id !== where.id) {
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

async function createApp(prisma, userId) {
  const moduleRef = await Test.createTestingModule({
    controllers: [ResumeController],
    providers: [
      ResumeService,
      SettingsService,
      { provide: PrismaService, useValue: prisma },
      JwtAuthGuard,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use((req, _res, next) => {
    req.user = req.user || { userId };
    next();
  });
  await app.init();
  return app;
}

async function withEnv(overrides, run) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('rate limiter is bypassed when rate-limit flag is disabled in settings', async () => {
  await withEnv(
    {
      FORCE_DISABLE_RATE_LIMIT: undefined,
      RESUME_CREATION_RATE_LIMIT_DEFAULT: 'false',
      NODE_ENV: 'production',
    },
    async () => {
      const userId = 'rate-limit-bypass-user';
      const prisma = createPrisma(userId, { rateLimitEnabled: false });
      const app = await createApp(prisma, userId);
      const requestCount = Number(RESUME_CREATE_RATE_LIMIT) + 10;

      for (let i = 0; i < requestCount; i += 1) {
        await request(app.getHttpServer())
          .post('/resumes')
          .send(buildResumePayload(`Bypass Resume ${i + 1}`))
          .expect(201);
      }

      assert.equal(prisma.__getState().resumes.length, requestCount);
      await app.close();
    },
  );
});

test('rate limiter blocks when rate-limit flag is enabled and returns code', async () => {
  await withEnv(
    {
      FORCE_DISABLE_RATE_LIMIT: undefined,
      RESUME_CREATION_RATE_LIMIT_DEFAULT: 'true',
      NODE_ENV: 'production',
    },
    async () => {
      const userId = 'rate-limit-block-user';
      const prisma = createPrisma(userId, { rateLimitEnabled: true });
      const app = await createApp(prisma, userId);

      for (let i = 0; i < Number(RESUME_CREATE_RATE_LIMIT); i += 1) {
        await request(app.getHttpServer())
          .post('/resumes')
          .send(buildResumePayload(`Allowed Resume ${i + 1}`))
          .expect(201);
      }

      const blocked = await request(app.getHttpServer())
        .post('/resumes')
        .send(buildResumePayload('Blocked Resume'))
        .expect(429);

      assert.equal(blocked.body.code, RESUME_CREATE_RATE_LIMIT_CODE);
      assert.equal(blocked.body.message, RESUME_CREATE_RATE_LIMIT_MESSAGE);
      await app.close();
    },
  );
});

test('rate limiter allows requests within configured limit when enabled', async () => {
  await withEnv(
    {
      FORCE_DISABLE_RATE_LIMIT: undefined,
      RESUME_CREATION_RATE_LIMIT_DEFAULT: 'true',
      NODE_ENV: 'production',
    },
    async () => {
      const userId = 'rate-limit-within-user';
      const prisma = createPrisma(userId, { rateLimitEnabled: true });
      const app = await createApp(prisma, userId);

      for (let i = 0; i < Number(RESUME_CREATE_RATE_LIMIT); i += 1) {
        await request(app.getHttpServer())
          .post('/resumes')
          .send(buildResumePayload(`Within Limit Resume ${i + 1}`))
          .expect(201);
      }

      assert.equal(prisma.__getState().resumes.length, Number(RESUME_CREATE_RATE_LIMIT));
      await app.close();
    },
  );
});
