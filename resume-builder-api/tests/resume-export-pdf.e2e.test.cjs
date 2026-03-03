const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const puppeteer = require('puppeteer');
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

function createPrisma() {
  const state = {
    user: {
      id: 'user-1',
      plan: 'PRO',
      atsScansUsed: 0,
      atsScansLimit: 50,
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
      templateId: 'modern-timeline',
      title: 'Template Export Resume',
      contact: {
        fullName: 'Jane Endpoint',
        email: 'jane.endpoint@example.com',
        phone: '9000000000',
        location: 'Pune, IN',
      },
      summary: 'Lead engineer delivering measurable outcomes across enterprise platforms.',
      skills: ['React', 'TypeScript', 'Node.js', 'AWS'],
      experience: [
        {
          company: 'Acme Corp',
          role: 'Engineering Lead',
          startDate: '2022-01',
          endDate: 'Present',
          highlights: ['Built a template-aware PDF export service.'],
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
          name: 'Resume Export API',
          role: 'Owner',
          startDate: '2025-01',
          endDate: '2026-01',
          highlights: ['Generated user-specific PDFs from HTML templates'],
        },
      ],
      certifications: [],
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

function parseBinary(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

test('GET /resumes/:id/pdf returns PDF bytes containing rendered user resume data', async () => {
  const prisma = createPrisma();
  const app = await createApp(prisma);

  const originalLaunch = puppeteer.launch;
  const originalDefaultLaunch = puppeteer.default?.launch;
  const mockLaunch = async () => ({
    newPage: async () => ({
      setContent: async (html) => {
        prisma.__capturedHtml = String(html || '');
      },
      pdf: async () => Buffer.from(prisma.__capturedHtml || '', 'utf8'),
    }),
    close: async () => {},
  });
  puppeteer.launch = mockLaunch;
  if (puppeteer.default) {
    puppeteer.default.launch = mockLaunch;
  }

  try {
    const response = await request(app.getHttpServer())
      .get('/resumes/resume-1/pdf')
      .buffer(true)
      .parse(parseBinary)
      .expect(200);

    assert.match(String(response.headers['content-type'] || ''), /application\/pdf/i);
    assert.ok(Buffer.isBuffer(response.body));
    const rendered = response.body.toString('utf8');
    assert.match(rendered, /Jane Endpoint/);
    assert.match(rendered, /template-layout-timeline/);
    assert.equal(prisma.__getState().user.pdfExportsUsed, 1);
  } finally {
    puppeteer.launch = originalLaunch;
    if (puppeteer.default && originalDefaultLaunch) {
      puppeteer.default.launch = originalDefaultLaunch;
    }
    await app.close();
  }
});
