const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { ResumeController } = require('../dist/resume/resume.controller.js');
const { ResumeService } = require('../dist/resume/resume.service.js');
const { PrismaService } = require('../dist/prisma/prisma.service.js');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard.js');

JwtAuthGuard.prototype.canActivate = function canActivate(context) {
  const req = context.switchToHttp().getRequest();
  req.user = { userId: 'user-1' };
  return true;
};

function buildResumePayload(title) {
  return {
    title,
    contact: {
      fullName: 'Free User',
      email: 'free.user@example.com',
      phone: '9999999999',
      location: 'Pune',
      links: ['https://www.linkedin.com/in/free-user'],
    },
    summary: 'Platform engineer with measurable delivery outcomes in production systems.',
    skills: ['React', 'Node.js', 'TypeScript'],
    experience: [
      {
        company: 'Acme Corp',
        role: 'Engineer',
        startDate: '2022-01',
        endDate: '2023-12',
        highlights: ['Led 5 engineers and reduced release failures by 30%.'],
      },
    ],
    education: [
      {
        institution: 'State University',
        degree: 'B.E Computer Science',
        startDate: '2016-01',
        endDate: '2020-01',
        details: ['Graduated with honors'],
      },
    ],
    projects: [],
    certifications: [],
  };
}

function createPrisma() {
  const state = {
    user: {
      id: 'user-1',
      email: 'free.user@example.com',
      fullName: 'Free User',
      passwordHash: 'hash',
      plan: 'FREE',
      resumesLimit: 1,
      atsScansLimit: 1,
      atsScansUsed: 0,
      aiTokensLimit: 8000,
      aiTokensUsed: 0,
      pdfExportsLimit: 5,
      pdfExportsUsed: 0,
      usagePeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      usagePeriodEnd: new Date('2099-01-01T00:00:00.000Z'),
      stripeCurrentPeriodEnd: null,
    },
    resumes: [],
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
      findFirst: async ({ where }) => {
        const found = state.resumes.find((item) => item.id === where.id && item.userId === where.userId);
        return found ? { ...found } : null;
      },
      findMany: async ({ where }) =>
        state.resumes.filter((item) => item.userId === where.userId).map((item) => ({ ...item })),
      update: async ({ where, data }) => {
        const idx = state.resumes.findIndex((item) => item.id === where.id);
        if (idx < 0) throw new Error('resume not found');
        state.resumes[idx] = { ...state.resumes[idx], ...data, updatedAt: new Date() };
        return { ...state.resumes[idx] };
      },
      delete: async ({ where }) => {
        const idx = state.resumes.findIndex((item) => item.id === where.id);
        if (idx < 0) throw new Error('resume not found');
        const removed = state.resumes[idx];
        state.resumes.splice(idx, 1);
        return { ...removed };
      },
    },
    __getState: () => state,
  };
}

async function createApp(prisma) {
  const moduleRef = await Test.createTestingModule({
    controllers: [ResumeController],
    providers: [
      ResumeService,
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

test('free plan allows first 2 resumes and blocks third; ATS allowed for first 2 scans then blocked', async () => {
  const prisma = createPrisma();
  const app = await createApp(prisma);

  const first = await request(app.getHttpServer())
    .post('/resumes')
    .send(buildResumePayload('Free Resume 1'))
    .expect(201);
  assert.equal(first.body.title, 'Free Resume 1');

  const second = await request(app.getHttpServer())
    .post('/resumes')
    .send(buildResumePayload('Free Resume 2'))
    .expect(201);
  assert.equal(second.body.title, 'Free Resume 2');

  const third = await request(app.getHttpServer())
    .post('/resumes')
    .send(buildResumePayload('Free Resume 3'))
    .expect(403);
  assert.match(JSON.stringify(third.body), /FREE_PLAN_RESUME_LIMIT_EXCEEDED/i);

  await request(app.getHttpServer())
    .post(`/resumes/${first.body.id}/ats-score`)
    .send({})
    .expect(201);

  await request(app.getHttpServer())
    .post(`/resumes/${second.body.id}/ats-score`)
    .send({})
    .expect(201);

  const blockedAts = await request(app.getHttpServer())
    .post(`/resumes/${first.body.id}/ats-score`)
    .send({})
    .expect(403);
  assert.match(JSON.stringify(blockedAts.body), /FREE_PLAN_ATS_LIMIT_EXCEEDED/i);

  const state = prisma.__getState();
  assert.equal(state.user.resumesLimit, 2);
  assert.equal(state.user.atsScansLimit, 2);

  await app.close();
});
