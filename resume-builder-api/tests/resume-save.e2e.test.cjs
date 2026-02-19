const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { ResumeController } = require('../dist/resume/resume.controller.js');
const { ResumeService } = require('../dist/resume/resume.service.js');
const { CompaniesController } = require('../dist/companies/companies.controller.js');
const { MetaController } = require('../dist/meta/meta.controller.js');
const { PrismaService } = require('../dist/prisma/prisma.service.js');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard.js');

JwtAuthGuard.prototype.canActivate = function canActivate(context) {
  const req = context.switchToHttp().getRequest();
  req.user = { userId: 'user-1' };
  return true;
};

function createInitialResume() {
  return {
    id: 'resume-1',
    userId: 'user-1',
    title: 'Senior Engineer Resume',
    contact: {
      fullName: 'Chandan Kumar',
      email: 'cks011992@gmail.com',
      phone: '9307003382',
      location: 'Pune, MH',
      links: ['https://www.linkedin.com/in/chandankumar007'],
    },
    summary: 'Engineering leader with 10+ years shipping high-impact enterprise platforms.',
    skills: ['React', 'Node.js', 'TypeScript', 'MongoDB'],
    languages: [],
    experience: [
      {
        company: 'Citi Corp',
        role: 'AVP',
        startDate: '2022-12',
        endDate: 'Present',
        highlights: ['Led a 10+ member team and improved system performance by 35%.'],
      },
    ],
    education: [
      {
        institution: 'Siddaganga Institute',
        degree: 'B.E Telecommunication',
        startDate: '2010-01',
        endDate: '2014-06',
        details: ['Graduated with strong foundation in communication systems.'],
      },
    ],
    projects: [],
    certifications: [],
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  };
}

function createPrisma(initialResume) {
  const state = {
    user: {
      id: 'user-1',
      plan: 'FREE',
      usagePeriodEnd: new Date('2099-01-01T00:00:00.000Z'),
      stripeCurrentPeriodEnd: null,
      resumesLimit: 2,
      atsScansLimit: 2,
      atsScansUsed: 0,
    },
    resume: { ...initialResume },
  };
  return {
    user: {
      findUnique: async ({ where }) => {
        if (where.id === state.user.id) {
          return { ...state.user };
        }
        return null;
      },
      update: async ({ where, data }) => {
        if (where.id !== state.user.id) {
          throw new Error('user not found');
        }
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
        if (where.id !== state.resume.id) {
          throw new Error('resume not found');
        }
        state.resume = {
          ...state.resume,
          ...data,
          updatedAt: new Date(),
        };
        return { ...state.resume };
      },
    },
    __getState: () => state,
  };
}

async function createApp(prisma) {
  const moduleRef = await Test.createTestingModule({
    controllers: [ResumeController, CompaniesController, MetaController],
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

function validUpdatePayload() {
  return {
    title: 'Tech Lead Resume',
    contact: {
      fullName: 'Chandan Kumar',
      email: 'cks011992@gmail.com',
      phone: '9307003382',
      location: 'Pune, MH',
      links: ['https://www.linkedin.com/in/chandankumar007'],
    },
    summary: 'Engineering leader with measurable delivery outcomes across enterprise systems.',
    skills: ['React', 'Node.js', 'TypeScript', 'MongoDB'],
    technicalSkills: ['React', 'Node.js', 'TypeScript', 'MongoDB'],
    softSkills: ['Leadership'],
    languages: [],
    experience: [
      {
        company: 'Citi Corp',
        role: 'AVP',
        startDate: 'Dec 2022',
        endDate: 'Present',
        highlights: ['Led cross-functional delivery and improved system performance by 35%.'],
      },
      {
        company: 'Ernst & Young',
        role: 'Senior Technology Consultant',
        startDate: '10/2021',
        endDate: '12/2022',
        highlights: ['Built reusable templates and cut frontend setup time by 60%.'],
      },
    ],
    education: [
      {
        institution: 'Siddaganga Institute',
        degree: 'B.E Telecommunication',
        startDate: '2010-01',
        endDate: '2014-06',
        details: ['Graduated with strong foundation in communication systems.'],
        gpa: 8.6,
      },
    ],
    projects: [],
    certifications: [],
  };
}

test('PATCH /resumes/:id accepts valid payload and persists normalized dates', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);
  const payload = validUpdatePayload();

  const response = await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(payload)
    .expect(200);

  assert.equal(response.body.id, 'resume-1');
  assert.equal(response.body.experience.length, 2);
  assert.equal(response.body.experience[0].startDate, '2022-12');
  assert.equal(response.body.experience[0].endDate, 'Present');
  assert.equal(response.body.experience[1].startDate, '2021-10');
  assert.equal(response.body.experience[1].endDate, '2022-12');
  assert.ok(Array.isArray(response.body.technicalSkills));
  assert.ok(response.body.technicalSkills.includes('React'));
  assert.ok(Array.isArray(response.body.softSkills));
  assert.ok(Array.isArray(response.body.languages));
  assert.ok(Array.isArray(response.body.skills));
  assert.equal(prisma.__getState().resume.title, 'Tech Lead Resume');

  await app.close();
});

test('PATCH /resumes/:id keeps legacy skills backward compatible when categories are omitted', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);
  const payload = validUpdatePayload();
  delete payload.technicalSkills;
  delete payload.softSkills;
  payload.skills = ['React', 'Node.js', 'System Design'];

  const response = await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(payload)
    .expect(200);

  assert.deepEqual(response.body.skills, ['React', 'Node.js', 'System Design']);
  assert.deepEqual(response.body.technicalSkills, ['React', 'Node.js', 'System Design']);
  assert.deepEqual(response.body.softSkills, []);

  await app.close();
});

test('PATCH /resumes/:id rejects invalid date format and end < start', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);

  const invalidFormat = validUpdatePayload();
  invalidFormat.experience[0].startDate = '2022/15';
  const invalidFormatResponse = await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(invalidFormat)
    .expect(400);

  const invalidFormatMessage = JSON.stringify(invalidFormatResponse.body);
  assert.match(invalidFormatMessage, /experience\.0\.startDate/i);

  const invalidOrder = validUpdatePayload();
  invalidOrder.experience[0].startDate = '2024-05';
  invalidOrder.experience[0].endDate = '2023-11';
  const invalidOrderResponse = await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(invalidOrder)
    .expect(400);

  const invalidOrderMessage = JSON.stringify(invalidOrderResponse.body);
  assert.match(invalidOrderMessage, /End date must be on or after start date/i);

  await app.close();
});

test('PATCH /resumes/:id rejects invalid education dates and GPA/percentage conflicts', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);

  const invalidEducationDate = validUpdatePayload();
  invalidEducationDate.education[0].startDate = '2010/13';
  const invalidEducationDateResponse = await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(invalidEducationDate)
    .expect(400);

  assert.match(JSON.stringify(invalidEducationDateResponse.body), /education\.0\.startDate/i);

  const conflictingScorePayload = validUpdatePayload();
  conflictingScorePayload.education[0].gpa = 8.8;
  conflictingScorePayload.education[0].percentage = 88.5;
  const conflictingScoreResponse = await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(conflictingScorePayload)
    .expect(400);

  assert.match(JSON.stringify(conflictingScoreResponse.body), /GPA|percentage/i);

  const outOfRangeScorePayload = validUpdatePayload();
  outOfRangeScorePayload.education[0].gpa = 10.8;
  const outOfRangeScoreResponse = await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(outOfRangeScorePayload)
    .expect(400);

  assert.match(JSON.stringify(outOfRangeScoreResponse.body), /education\.0\.gpa/i);

  await app.close();
});

test('PATCH /resumes/:id validates optional project URL format', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);

  const validPayload = validUpdatePayload();
  validPayload.projects = [
    {
      name: 'ATS Builder',
      role: 'Lead Engineer',
      startDate: '2024-01',
      endDate: '2024-07',
      url: 'https://github.com/example/ats-builder',
      highlights: ['Built project editor improvements.'],
    },
  ];
  await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(validPayload)
    .expect(200);

  const invalidPayload = validUpdatePayload();
  invalidPayload.projects = [
    {
      name: 'ATS Builder',
      role: 'Lead Engineer',
      startDate: '2024-01',
      endDate: '2024-07',
      url: 'http://github.com/example/ats-builder',
      highlights: ['Built project editor improvements.'],
    },
  ];
  const invalidResponse = await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(invalidPayload)
    .expect(400);

  assert.match(JSON.stringify(invalidResponse.body), /Project URL must start with https:\/\//i);

  await app.close();
});

test('PATCH /resumes/:id returns structured field paths when action verb ratio is below 60%', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);

  const invalidBulletsPayload = validUpdatePayload();
  invalidBulletsPayload.experience = [
    {
      company: 'Citi Corp',
      role: 'AVP',
      startDate: '2022-12',
      endDate: 'Present',
      highlights: [
        'Responsible for frontend upgrades and planning sprint items.',
        'Worked on stakeholder reviews and release ceremonies.',
      ],
    },
    {
      company: 'Ernst & Young',
      role: 'Senior Technology Consultant',
      startDate: '2021-10',
      endDate: '2022-12',
      highlights: [
        'Handled template setup and team communication workflows.',
      ],
    },
  ];

  const failed = await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(invalidBulletsPayload)
    .expect(422);

  assert.equal(failed.body.code, 'ATS_ACTION_VERB_RATIO');
  assert.ok(Array.isArray(failed.body.fields));
  assert.ok(failed.body.fields.some((field) => field.path === 'experience[0].highlights[0]'));
  assert.ok(failed.body.fields.some((field) => field.path === 'experience[0].highlights[1]'));
  assert.ok(failed.body.fields.some((field) => field.path === 'experience[1].highlights[0]'));
  assert.ok(failed.body.fields.every((field) => Array.isArray(field.suggestions) && field.suggestions.length > 0));

  const fixedPayload = validUpdatePayload();
  fixedPayload.experience = [
    {
      company: 'Citi Corp',
      role: 'AVP',
      startDate: '2022-12',
      endDate: 'Present',
      highlights: [
        'Led frontend upgrades that improved performance by 35%.',
        'Built sprint planning workflows that reduced release delays by 20%.',
      ],
    },
    {
      company: 'Ernst & Young',
      role: 'Senior Technology Consultant',
      startDate: '2021-10',
      endDate: '2022-12',
      highlights: [
        'Developed reusable templates that cut setup time by 60%.',
      ],
    },
  ];

  await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(fixedPayload)
    .expect(200);

  await app.close();
});

test('PATCH /resumes/:id persists two user-entered projects in order', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);

  const payload = validUpdatePayload();
  payload.projects = [
    {
      name: 'ATS Resume Builder',
      role: 'Lead Engineer',
      startDate: '2024-01',
      endDate: '2024-06',
      url: 'https://github.com/example/ats-builder',
      highlights: ['Built review flow for resume projects and validation.'],
    },
    {
      name: 'Resume Parser QA',
      role: 'Full Stack Engineer',
      startDate: '2023-07',
      endDate: '2023-12',
      url: 'https://bitbucket.org/example/resume-parser-qa',
      highlights: ['Implemented regression checks for resume extraction.'],
    },
  ];

  const response = await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(payload)
    .expect(200);

  assert.equal(response.body.projects.length, 2);
  assert.equal(response.body.projects[0].name, 'ATS Resume Builder');
  assert.equal(response.body.projects[1].name, 'Resume Parser QA');

  await app.close();
});

test('PATCH /resumes/:id migrates spoken languages out of technical skills and persists languages', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);

  const payload = validUpdatePayload();
  payload.skills = ['React', 'Node.js', 'TypeScript', 'English', 'Hindi'];
  payload.technicalSkills = ['React', 'Node.js', 'TypeScript', 'English', 'Hindi'];
  payload.softSkills = ['Leadership'];
  payload.languages = [];

  const response = await request(app.getHttpServer())
    .patch('/resumes/resume-1')
    .send(payload)
    .expect(200);

  assert.ok(Array.isArray(response.body.languages));
  assert.ok(response.body.languages.includes('English'));
  assert.ok(response.body.languages.includes('Hindi'));
  assert.equal(response.body.technicalSkills.includes('English'), false);
  assert.equal(response.body.technicalSkills.includes('Hindi'), false);

  const refreshed = await request(app.getHttpServer())
    .get('/resumes/resume-1')
    .expect(200);
  assert.ok(Array.isArray(refreshed.body.languages));
  assert.ok(refreshed.body.languages.includes('English'));
  assert.ok(refreshed.body.languages.includes('Hindi'));

  await app.close();
});

test('GET /companies/suggest returns filtered company names', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);

  const response = await request(app.getHttpServer())
    .get('/companies/suggest?q=inf')
    .expect(200);

  assert.ok(Array.isArray(response.body.suggestions));
  assert.ok(response.body.suggestions.some((item) => String(item).toLowerCase().includes('infosys')));

  await app.close();
});

test('GET /meta/suggest/institutions returns filtered results with limit', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);

  const response = await request(app.getHttpServer())
    .get('/meta/suggest/institutions?q=iit&limit=5')
    .expect(200);

  assert.ok(Array.isArray(response.body.items));
  assert.ok(response.body.items.length <= 5);
  assert.ok(response.body.items.some((item) => String(item).toLowerCase().includes('iit')));

  await app.close();
});

test('GET /meta/suggest/skills returns filtered results by type', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);

  const technicalResponse = await request(app.getHttpServer())
    .get('/meta/suggest/skills?q=react&type=technical&limit=6')
    .expect(200);
  assert.ok(Array.isArray(technicalResponse.body.items));
  assert.ok(technicalResponse.body.items.length <= 6);
  assert.ok(technicalResponse.body.items.some((item) => String(item).toLowerCase().includes('react')));

  const softResponse = await request(app.getHttpServer())
    .get('/meta/suggest/skills?q=communication&type=soft&limit=6')
    .expect(200);
  assert.ok(Array.isArray(softResponse.body.items));
  assert.ok(softResponse.body.items.length <= 6);
  assert.ok(softResponse.body.items.some((item) => String(item).toLowerCase().includes('communication')));

  await app.close();
});

test('GET /meta/suggest/certifications returns filtered certification suggestions', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);

  const response = await request(app.getHttpServer())
    .get('/meta/suggest/certifications?q=azure&limit=5')
    .expect(200);

  assert.ok(Array.isArray(response.body.items));
  assert.ok(response.body.items.length <= 5);
  assert.ok(response.body.items.some((item) => String(item).toLowerCase().includes('az-900') || String(item).toLowerCase().includes('azure')));

  await app.close();
});

test('POST /resumes/:id/ats-score returns action-verb rule metrics, failed indices, and suggestions', async () => {
  const prisma = createPrisma(createInitialResume());
  const app = await createApp(prisma);
  prisma.__getState().resume.experience = [
    {
      company: 'Citi Corp',
      role: 'AVP',
      startDate: '2022-12',
      endDate: 'Present',
      highlights: [
        'Responsible for performance tuning and release follow-up.',
        'Worked on mentoring team members and stakeholder communication.',
      ],
    },
    {
      company: 'Ernst & Young',
      role: 'Senior Technology Consultant',
      startDate: '2021-10',
      endDate: '2022-12',
      highlights: [
        'Built reusable templates and reduced frontend setup time by 60%.',
      ],
    },
  ];

  const result = await request(app.getHttpServer())
    .post('/resumes/resume-1/ats-score')
    .send({})
    .expect(201);

  assert.ok(result.body.actionVerbRule);
  assert.equal(typeof result.body.actionVerbRule.percentage, 'number');
  assert.equal(Array.isArray(result.body.actionVerbRule.failedBullets), true);
  assert.ok(result.body.actionVerbRule.failedBullets.length >= 1);
  assert.ok(result.body.actionVerbRule.failedBullets.every((item) => Array.isArray(item.suggestions) && item.suggestions.length > 0));

  await app.close();
});
