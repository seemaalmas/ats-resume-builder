import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReviewAtsRoute,
  canContinueToAts,
  canContinueToReview,
  continueToReviewAtsFromStart,
  continueToReviewFromStart,
  type SectionState,
  buildEditorRoute,
  buildPendingUploadSession,
  buildResumePayload,
  consumePendingUploadSession,
  createScratchEditorState,
  detectExperienceLevelFromResume,
  getNavigationGateState,
  resolveEditorUploadNavigation,
  savePendingUploadSession,
} from '../src/lib/resume-flow';
import { applyParsedResume } from '../src/lib/resume-ingest';
import { useResumeStore } from '../src/lib/resume-store';

class MemoryStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }

  removeItem(key: string) {
    this.data.delete(key);
  }
}

test('upload flow caches parsed data and provides redirect/editor-ready state', () => {
  const uploadResult = {
    title: 'Imported Resume',
    summary: 'Backend engineer delivering measurable reliability gains.',
    skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
    experience: [
      {
        company: 'Acme Corp',
        role: 'Senior Engineer',
        startDate: '2022',
        endDate: 'Present',
        highlights: ['Improved uptime to 99.99% across core services'],
      },
      {
        company: 'Beta Labs',
        role: 'Engineer',
        startDate: '2019',
        endDate: '2022',
        highlights: ['Reduced processing costs by 27%'],
      },
    ],
    education: [
      {
        institution: 'State University',
        degree: 'B.S. Computer Science',
        startDate: '2015',
        endDate: '2019',
        details: ['Graduated with honors'],
      },
    ],
    projects: [],
    certifications: [],
    roleLevel: 'SENIOR' as const,
    parsed: {
      title: 'Imported Resume',
      summary: 'Backend engineer delivering measurable reliability gains.',
      skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
      experience: [
        {
          company: 'Acme Corp',
          role: 'Senior Engineer',
          startDate: '2022',
          endDate: 'Present',
          highlights: ['Improved uptime to 99.99% across core services'],
        },
        {
          company: 'Beta Labs',
          role: 'Engineer',
          startDate: '2019',
          endDate: '2022',
          highlights: ['Reduced processing costs by 27%'],
        },
      ],
      education: [
        {
          institution: 'State University',
          degree: 'B.S. Computer Science',
          startDate: '2015',
          endDate: '2019',
          details: ['Graduated with honors'],
        },
      ],
      projects: [],
      certifications: [],
      roleLevel: 'SENIOR' as const,
    },
  };

  const pending = buildPendingUploadSession(uploadResult);
  assert.equal(pending.uploadSummary.companyCount, 2);
  assert.ok(pending.uploadSummary.sectionsPopulated.includes('experience'));
  assert.ok(pending.uploadSummary.sectionsPopulated.includes('skills'));
  assert.equal(buildEditorRoute('review', 'modern'), '/resume?flow=review&template=modern');

  const storage = new MemoryStorage();
  assert.equal(savePendingUploadSession(pending, storage), true);
  const consumed = consumePendingUploadSession(storage);
  assert.ok(consumed);
  assert.equal(canContinueToReview(consumed), true);
  assert.equal(consumed!.resume.experience.length, 2);
  assert.equal(consumed!.uploadSummary.reviewTarget, 'contact');
  assert.equal(consumePendingUploadSession(storage), null);
});

test('scratch flow starts with an empty editor state', () => {
  const scratch = createScratchEditorState();
  assert.equal(buildEditorRoute('scratch'), '/resume?flow=scratch');
  assert.equal(buildReviewAtsRoute('modern', 'resume-1'), '/resume/review?template=modern&id=resume-1');
  assert.equal(buildReviewAtsRoute(), '/resume/review');
  assert.equal(scratch.resume.summary, '');
  assert.equal(scratch.resume.skills.length, 0);
  assert.equal(scratch.resume.experience.length, 0);
  assert.equal(scratch.uploadSummary, null);
});

test('navigation gating blocks next step when current required section has errors', () => {
  const feedback = {
    contact: { level: 'good', text: 'ok' },
    summary: { level: 'error', text: 'summary missing' },
    experience: { level: 'good', text: 'ok' },
    education: { level: 'good', text: 'ok' },
    skills: { level: 'good', text: 'ok' },
    languages: { level: 'good', text: 'ok' },
    projects: { level: 'good', text: 'ok' },
    certifications: { level: 'good', text: 'ok' },
  } as const;

  const gate = getNavigationGateState(feedback, 3);
  assert.equal(gate.activeStepType, 'summary');
  assert.equal(gate.canProceedCurrent, false);
  assert.equal(gate.isStepLocked('experience'), true);
  assert.equal(canContinueToAts(feedback as any), false);
});

test('resume save payload builder remains backward-compatible for editor save', () => {
  const sections: SectionState[] = [
    { id: 'sec-contact', type: 'contact', enabled: true, required: true },
    { id: 'sec-summary', type: 'summary', enabled: true, required: true },
    { id: 'sec-experience', type: 'experience', enabled: true, required: true },
    { id: 'sec-education', type: 'education', enabled: true, required: true },
    { id: 'sec-skills', type: 'skills', enabled: true, required: true },
    { id: 'sec-projects', type: 'projects', enabled: true, required: false },
    { id: 'sec-certifications', type: 'certifications', enabled: true, required: false },
  ];

  const payload = buildResumePayload(
    {
      title: '  Principal Engineer Resume  ',
      contact: { fullName: '  Alex Rivera  ', email: 'alex@example.com' },
      summary: '  Platform engineer shipping high-impact backend systems.  ',
      skills: ['TypeScript', ' Node.js ', 'PostgreSQL'],
      languages: ['English'],
      experience: [
        {
          company: ' Acme Corp ',
          role: ' Principal Engineer ',
          startDate: '2021',
          endDate: 'Present',
          highlights: ['Led migration reducing infra cost by 34%'],
        },
      ],
      education: [
        {
          institution: 'State University',
          degree: 'B.S. Computer Science',
          startDate: '2012',
          endDate: '2016',
          details: ['Graduated with honors'],
        },
      ],
      projects: [
        {
          name: 'Resume Parser',
          role: 'Lead',
          startDate: '2023',
          endDate: '2024',
          highlights: ['Built NLP pipeline for structured extraction'],
        },
      ],
      certifications: [
        {
          name: 'AWS Solutions Architect',
          issuer: 'AWS',
          date: '2024',
          details: ['Professional'],
        },
      ],
    },
    sections,
  );

  assert.equal(payload.title, 'Principal Engineer Resume');
  assert.equal(payload.summary, 'Platform engineer shipping high-impact backend systems.');
  assert.equal(payload.skills.length, 3);
  assert.deepEqual(payload.languages, ['English']);
  assert.equal(payload.experience.length, 1);
  assert.equal(payload.education.length, 1);
  assert.equal(payload.projects.length, 1);
  assert.equal(payload.certifications.length, 1);
  assert.equal(payload.contact?.fullName, 'Alex Rivera');
});

test('scratch flow upload re-runs shared detection and resolves to experienced levels', () => {
  const experiencedUpload = {
    title: 'Imported Resume',
    summary: 'Engineering leader with multiple production roles.',
    skills: ['TypeScript', 'React', 'Node.js'],
    experience: [
      {
        company: 'Citi Corp',
        role: 'AVP',
        startDate: 'Dec 2022',
        endDate: 'Present',
        highlights: ['Led cross-functional teams to deliver enterprise web platforms'],
      },
      {
        company: 'Ernst & Young',
        role: 'Senior Technology Consultant',
        startDate: 'Oct 2021',
        endDate: 'Dec 2022',
        highlights: ['Improved frontend velocity by 60% via reusable templates'],
      },
      {
        company: 'Infosys',
        role: 'Lead UI Developer',
        startDate: 'Jul 2014',
        endDate: 'Aug 2020',
        highlights: ['Managed a 9-member team for enterprise banking UI'],
      },
    ],
    education: [],
    projects: [],
    certifications: [],
    parsed: {
      title: 'Imported Resume',
      summary: 'Engineering leader with multiple production roles.',
      skills: ['TypeScript', 'React', 'Node.js'],
      experience: [
        {
          company: 'Citi Corp',
          role: 'AVP',
          startDate: 'Dec 2022',
          endDate: 'Present',
          highlights: ['Led cross-functional teams to deliver enterprise web platforms'],
        },
        {
          company: 'Ernst & Young',
          role: 'Senior Technology Consultant',
          startDate: 'Oct 2021',
          endDate: 'Dec 2022',
          highlights: ['Improved frontend velocity by 60% via reusable templates'],
        },
        {
          company: 'Infosys',
          role: 'Lead UI Developer',
          startDate: 'Jul 2014',
          endDate: 'Aug 2020',
          highlights: ['Managed a 9-member team for enterprise banking UI'],
        },
      ],
      education: [],
      projects: [],
      certifications: [],
    },
  };

  const result = applyParsedResume(experiencedUpload, {
    baseResume: createScratchEditorState().resume,
  });
  const detected = detectExperienceLevelFromResume(result.resume);
  assert.ok(result.uploadSummary.roleLevel === 'MID' || result.uploadSummary.roleLevel === 'SENIOR');
  assert.ok(detected.level === 'MID' || detected.level === 'SENIOR');
  assert.ok(result.uploadSummary.experienceSignals.roleCount >= 2);
});

test('continue to ATS remains gated until required sections are valid', () => {
  const blocked = {
    contact: { level: 'good', text: 'ok' },
    summary: { level: 'error', text: 'summary missing' },
    experience: { level: 'good', text: 'ok' },
    education: { level: 'good', text: 'ok' },
    skills: { level: 'good', text: 'ok' },
    projects: { level: 'warn', text: 'optional' },
    certifications: { level: 'warn', text: 'optional' },
  } as const;
  const valid = {
    contact: { level: 'good', text: 'ok' },
    summary: { level: 'good', text: 'ok' },
    experience: { level: 'good', text: 'ok' },
    education: { level: 'good', text: 'ok' },
    skills: { level: 'good', text: 'ok' },
    projects: { level: 'warn', text: 'optional' },
    certifications: { level: 'warn', text: 'optional' },
  } as const;

  assert.equal(canContinueToAts(blocked as any), false);
  assert.equal(canContinueToAts(valid as any), true);
});

test('/resume/start continue flow enables review, navigates to editor route, and stages Zustand data', () => {
  useResumeStore.getState().resetResume();

  const uploadResult = {
    title: 'Imported Resume',
    summary: 'Engineering leader with multiple product roles.',
    skills: ['TypeScript', 'React', 'Node.js'],
    experience: [
      {
        company: 'Citi Corp',
        role: 'AVP',
        startDate: 'Dec 2022',
        endDate: 'Present',
        highlights: ['Led cross-functional platform delivery'],
      },
      {
        company: 'Citi Corp',
        role: 'Engineering Manager',
        startDate: '01/2021',
        endDate: '11/2022',
        highlights: ['Reduced release failures by 35%'],
      },
      {
        company: 'Ernst & Young',
        role: 'Senior Technology Consultant',
        startDate: 'Oct 2020',
        endDate: 'Dec 2020',
        highlights: ['Improved developer velocity by 25%'],
      },
      {
        company: 'Ernst & Young',
        role: 'Technology Consultant',
        startDate: '2018',
        endDate: '2019',
        highlights: ['Standardized UI workflows across teams'],
      },
    ],
    education: [],
    projects: [],
    certifications: [],
    roleLevel: 'SENIOR' as const,
    fileName: 'chandankumar_26Apr_12.pdf',
    parsed: {
      title: 'Imported Resume',
      summary: 'Engineering leader with multiple product roles.',
      skills: ['TypeScript', 'React', 'Node.js'],
      experience: [
        {
          company: 'Citi Corp',
          role: 'AVP',
          startDate: 'Dec 2022',
          endDate: 'Present',
          highlights: ['Led cross-functional platform delivery'],
        },
        {
          company: 'Citi Corp',
          role: 'Engineering Manager',
          startDate: '01/2021',
          endDate: '11/2022',
          highlights: ['Reduced release failures by 35%'],
        },
        {
          company: 'Ernst & Young',
          role: 'Senior Technology Consultant',
          startDate: 'Oct 2020',
          endDate: 'Dec 2020',
          highlights: ['Improved developer velocity by 25%'],
        },
        {
          company: 'Ernst & Young',
          role: 'Technology Consultant',
          startDate: '2018',
          endDate: '2019',
          highlights: ['Standardized UI workflows across teams'],
        },
      ],
      education: [],
      projects: [],
      certifications: [],
      roleLevel: 'SENIOR' as const,
    },
  };

  const pending = buildPendingUploadSession(uploadResult as any);
  assert.equal(canContinueToReview(pending), true);

  const storage = new MemoryStorage();
  const navigation = continueToReviewFromStart({
    session: pending,
    template: 'modern',
    setResume: useResumeStore.getState().setResume,
    setUploadedFileName: useResumeStore.getState().setUploadedFileName,
    storage,
  });

  assert.equal(navigation.enabled, true);
  assert.equal(navigation.href, '/resume?flow=review&template=modern');
  assert.equal(useResumeStore.getState().resume.experience.length, 4);
  assert.equal(useResumeStore.getState().resume.summary, 'Engineering leader with multiple product roles.');
  assert.equal(useResumeStore.getState().uploadedFileName, 'chandankumar_26Apr_12.pdf');

  const consumed = consumePendingUploadSession(storage);
  assert.ok(consumed);
  assert.equal(consumed!.resume.experience.length, 4);
  assert.notEqual(consumed!.resume.summary, '');
});

test('/resume/start continue still returns editor route when browser storage is unavailable', () => {
  useResumeStore.getState().resetResume();
  const pending = buildPendingUploadSession({
    title: 'Imported Resume',
    summary: 'Backend engineer focused on reliability.',
    skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
    experience: [
      {
        company: 'Acme Corp',
        role: 'Senior Engineer',
        startDate: '2022',
        endDate: 'Present',
        highlights: ['Improved uptime to 99.99%'],
      },
    ],
    education: [],
    projects: [],
    certifications: [],
    parsed: {
      title: 'Imported Resume',
      summary: 'Backend engineer focused on reliability.',
      skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
      experience: [
        {
          company: 'Acme Corp',
          role: 'Senior Engineer',
          startDate: '2022',
          endDate: 'Present',
          highlights: ['Improved uptime to 99.99%'],
        },
      ],
      education: [],
      projects: [],
      certifications: [],
    },
  } as any);

  const navigation = continueToReviewFromStart({
    session: pending,
    template: '',
    setResume: useResumeStore.getState().setResume,
  });

  assert.equal(navigation.enabled, true);
  assert.equal(navigation.cached, false);
  assert.equal(navigation.href, '/resume?flow=review');
  assert.equal(useResumeStore.getState().resume.experience.length, 1);
});

test('/resume/start review-and-ats flow navigates to /resume/review and preserves parsed store data', () => {
  useResumeStore.getState().resetResume();
  const pending = buildPendingUploadSession({
    title: 'Imported Resume',
    summary: 'Product engineer with production systems experience.',
    skills: ['TypeScript', 'React', 'Node.js'],
    experience: [
      {
        company: 'Citi Corp',
        role: 'AVP',
        startDate: 'Dec 2022',
        endDate: 'Present',
        highlights: ['Led enterprise frontend modernization'],
      },
      {
        company: 'Ernst & Young',
        role: 'Senior Technology Consultant',
        startDate: 'Oct 2021',
        endDate: 'Dec 2022',
        highlights: ['Built reusable template architecture'],
      },
    ],
    education: [],
    projects: [],
    certifications: [],
    fileName: 'chandankumar_26Apr_12.pdf',
    parsed: {
      title: 'Imported Resume',
      summary: 'Product engineer with production systems experience.',
      skills: ['TypeScript', 'React', 'Node.js'],
      experience: [
        {
          company: 'Citi Corp',
          role: 'AVP',
          startDate: 'Dec 2022',
          endDate: 'Present',
          highlights: ['Led enterprise frontend modernization'],
        },
        {
          company: 'Ernst & Young',
          role: 'Senior Technology Consultant',
          startDate: 'Oct 2021',
          endDate: 'Dec 2022',
          highlights: ['Built reusable template architecture'],
        },
      ],
      education: [],
      projects: [],
      certifications: [],
    },
  } as any);

  const storage = new MemoryStorage();
  const navigation = continueToReviewAtsFromStart({
    session: pending,
    template: 'modern',
    setResume: useResumeStore.getState().setResume,
    setUploadedFileName: useResumeStore.getState().setUploadedFileName,
    storage,
  });

  assert.equal(navigation.enabled, true);
  assert.equal(navigation.href, '/resume/review?template=modern');
  assert.equal(useResumeStore.getState().resume.summary, 'Product engineer with production systems experience.');
  assert.equal(useResumeStore.getState().resume.experience[0]?.role, 'AVP');
  assert.equal(useResumeStore.getState().uploadedFileName, 'chandankumar_26Apr_12.pdf');
});

test('scratch flow upload resolves to review route and imported mode badge', () => {
  const navigation = resolveEditorUploadNavigation('scratch', 'modern');
  assert.equal(navigation.shouldReplace, true);
  assert.equal(navigation.href, '/resume?flow=review&template=modern');
  assert.equal(navigation.modeBadge, 'Imported resume');
});
