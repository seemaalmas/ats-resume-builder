const assert = require('node:assert/strict');
const test = require('node:test');
const { ResumeService } = require('../dist/resume/resume.service.js');

function createBaseResume(templateId = 'classic') {
  return {
    id: 'resume-1',
    userId: 'user-1',
    title: 'Template Test Resume',
    contact: {
      fullName: 'Template Tester',
      email: 'tester@example.com',
      phone: '1234567890',
      location: 'Remote',
    },
    summary: 'Testing template persistence.',
    skills: ['Node.js', 'TypeScript', 'NestJS'],
    languages: [],
    experience: [
      {
        company: 'Acme',
        role: 'Engineer',
        startDate: '2023-01',
        endDate: '2024-01',
        highlights: ['Reduced resume review time by 35%.'],
      },
    ],
    education: [
      {
        institution: 'State University',
        degree: 'B.Sc.',
        startDate: '2016-01',
        endDate: '2020-01',
        details: ['Graduated with honors.'],
      },
    ],
    projects: [],
    certifications: [],
    templateId,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  };
}

function createSettingsService() {
  return {
    isRateLimitEnabled: async () => false,
    isPaymentFeatureEnabled: async () => false,
  };
}

function createPayload(templateId) {
  const base = createBaseResume(templateId);
  return {
    title: base.title,
    contact: base.contact,
    summary: base.summary,
    skills: base.skills,
    technicalSkills: [],
    softSkills: [],
    languages: base.languages,
    experience: base.experience,
    education: base.education,
    projects: base.projects,
    certifications: base.certifications,
    templateId,
  };
}

function createPrisma({ existingResumes = 1, templateId = 'classic' } = {}) {
  const state = {
    user: {
      id: 'user-1',
      plan: 'FREE',
      resumesLimit: 2,
      atsScansLimit: 2,
      atsScansUsed: 0,
      pdfExportsLimit: 5,
      usagePeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24),
      stripeCurrentPeriodEnd: null,
    },
    resume: createBaseResume(templateId),
    existingResumes,
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
      count: async () => state.existingResumes,
      create: async ({ data }) => {
        const now = new Date();
        state.resume = {
          id: data.id || 'resume-1',
          userId: data.userId,
          title: data.title,
          contact: data.contact,
          summary: data.summary,
          skills: data.skills,
          languages: data.languages,
          experience: data.experience,
          education: data.education,
          projects: data.projects,
          certifications: data.certifications,
          templateId: data.templateId,
          createdAt: now,
          updatedAt: now,
        };
        state.existingResumes += 1;
        return { ...state.resume };
      },
      findFirst: async ({ where }) => {
        if (where.id === state.resume.id && where.userId === state.resume.userId) {
          return { ...state.resume };
        }
        return null;
      },
      update: async ({ where, data }) => {
        if (where.id !== state.resume.id) throw new Error('resume not found');
        state.resume = { ...state.resume, ...data, updatedAt: new Date() };
        return { ...state.resume };
      },
    },
    __getState: () => state,
  };
}

test('ResumeService.create persists templateId', async () => {
  const prisma = createPrisma({ existingResumes: 0 });
  const service = new ResumeService(prisma, createSettingsService());
  const payload = createPayload('modern');

  const created = await service.create('user-1', payload);

  assert.equal(created.templateId, 'modern');
  assert.equal(prisma.__getState().resume.templateId, 'modern');
});

test('ResumeService.update respects templateId overrides', async () => {
  const prisma = createPrisma({ existingResumes: 1, templateId: 'classic' });
  const service = new ResumeService(prisma, createSettingsService());

  const updated = await service.update('user-1', 'resume-1', { templateId: 'senior' });

  assert.equal(updated.templateId, 'senior');
  assert.equal(prisma.__getState().resume.templateId, 'senior');
});
