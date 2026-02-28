const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { ResumeController } = require('../dist/resume/resume.controller.js');
const { ResumeService } = require('../dist/resume/resume.service.js');
const { PrismaService } = require('../dist/prisma/prisma.service.js');
const { SettingsService } = require('../dist/settings/settings.service.js');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard.js');

JwtAuthGuard.prototype.canActivate = function canActivate(context) {
  const req = context.switchToHttp().getRequest();
  req.user = { userId: 'user-1' };
  return true;
};

function createPrismaState() {
  const state = {
    user: {
      id: 'user-1',
      plan: 'FREE',
      resumesLimit: 2,
      atsScansLimit: 2,
      atsScansUsed: 0,
      pdfExportsLimit: 5,
      pdfExportsUsed: 0,
      usagePeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      usagePeriodEnd: new Date('2099-01-01T00:00:00.000Z'),
    },
    resume: {
      id: 'resume-1',
      userId: 'user-1',
      title: 'ATS Score Fixture',
      contact: { fullName: 'Score Tester' },
      summary: 'Engineer building reliable infrastructure.',
      skills: ['Node.js', 'TypeScript', 'NestJS'],
      experience: [
        {
          company: 'Acme Corp',
          role: 'Platform Engineer',
          startDate: '2020-01',
          endDate: '2023-12',
          highlights: ['Responsible for launching microservices and observability.'],
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
      paymentFeatureEnabled: false,
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
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
      findFirst: async ({ where }) =>
        where.id === state.resume.id && where.userId === state.resume.userId ? { ...state.resume } : null,
    },
    appSetting: {
      findUnique: async ({ where }) => (where.id === state.appSetting.id ? { ...state.appSetting } : null),
      upsert: async ({ where, update, create }) => {
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
        state.appSetting = { ...state.appSetting, ...(update || {}), updatedAt: new Date() };
        return { ...state.appSetting };
      },
    },
  };
}

async function createApp(prisma) {
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
    req.user = req.user || { userId: 'user-1' };
    next();
  });
  await app.init();
  return app;
}

test('/resumes/:id/ats-score returns sane score when JD missing', async () => {
  const prisma = createPrismaState();
  const app = await createApp(prisma);

  const response = await request(app.getHttpServer())
    .post('/resumes/resume-1/ats-score')
    .send({})
    .expect(201);

  assert.equal(response.body.meta.jobDescriptionUsed, false);
  assert.ok(response.body.atsScore < 100, 'Score should reflect missing JD but not clamp to 100');
  assert.ok(response.body.issues.some((issue) => issue.code === 'JD_SUGGESTION' && issue.severity === 'info'));

  await app.close();
});

test('/resumes/:id/ats-score marks JD usage when provided', async () => {
  const prisma = createPrismaState();
  const app = await createApp(prisma);

  const response = await request(app.getHttpServer())
    .post('/resumes/resume-1/ats-score')
    .send({ jdText: 'Platform engineer building resilient distributed systems.' })
    .expect(201);

  assert.equal(response.body.meta.jobDescriptionUsed, true);
  assert.ok(response.body.atsScore <= 100);
  await app.close();
});
