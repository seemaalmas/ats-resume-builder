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
  clearPendingUploadSession,
  consumePendingUploadSession,
  createScratchEditorState,
  readPendingUploadSession,
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

test('readPendingUploadSession preserves data across multiple reads without consuming', () => {
  const storage = new MemoryStorage();
  const pending = buildPendingUploadSession({
    title: 'Persistence Test',
    summary: 'Should survive multiple reads.',
    skills: ['JS'],
    experience: [
      { company: 'TestCo', role: 'Dev', startDate: '2023', endDate: 'Present', highlights: ['Built things'] },
    ],
    education: [],
    projects: [],
    certifications: [],
    parsed: {
      title: 'Persistence Test',
      summary: 'Should survive multiple reads.',
      skills: ['JS'],
      experience: [
        { company: 'TestCo', role: 'Dev', startDate: '2023', endDate: 'Present', highlights: ['Built things'] },
      ],
      education: [],
      projects: [],
      certifications: [],
    },
  } as any);

  savePendingUploadSession(pending, storage);

  // First read — non-destructive
  const first = readPendingUploadSession(storage);
  assert.ok(first);
  assert.equal(first!.resume.experience.length, 1);

  // Second read — still available
  const second = readPendingUploadSession(storage);
  assert.ok(second);
  assert.equal(second!.resume.summary, 'Should survive multiple reads.');

  // Third read — still available (simulates effect re-runs / page refreshes)
  const third = readPendingUploadSession(storage);
  assert.ok(third);
  assert.equal(third!.resume.experience[0]?.company, 'TestCo');

  // Explicit clear removes it
  clearPendingUploadSession(storage);
  assert.equal(readPendingUploadSession(storage), null);
});

test('pending upload session survives simulated page navigation (non-destructive restore)', () => {
  const storage = new MemoryStorage();
  useResumeStore.getState().resetResume();

  const pending = buildPendingUploadSession({
    title: 'Navigation Test',
    summary: 'Data should persist through navigation.',
    skills: ['React', 'TypeScript'],
    experience: [
      { company: 'NavCo', role: 'Engineer', startDate: '2022', endDate: 'Present', highlights: ['Built UI'] },
    ],
    education: [
      { institution: 'Test Univ', degree: 'CS', startDate: '2018', endDate: '2022', details: [] },
    ],
    projects: [],
    certifications: [],
    parsed: {
      title: 'Navigation Test',
      summary: 'Data should persist through navigation.',
      skills: ['React', 'TypeScript'],
      experience: [
        { company: 'NavCo', role: 'Engineer', startDate: '2022', endDate: 'Present', highlights: ['Built UI'] },
      ],
      education: [
        { institution: 'Test Univ', degree: 'CS', startDate: '2018', endDate: '2022', details: [] },
      ],
      projects: [],
      certifications: [],
    },
  } as any);

  // Simulate /resume/start: save session and stage in store
  const nav = continueToReviewFromStart({
    session: pending,
    template: '',
    setResume: useResumeStore.getState().setResume,
    setUploadedFileName: useResumeStore.getState().setUploadedFileName,
    storage,
  });
  assert.equal(nav.enabled, true);
  assert.equal(nav.cached, true);
  assert.equal(useResumeStore.getState().resume.experience.length, 1);

  // Simulate navigation: Zustand store is reset (as happens in the reset effect)
  useResumeStore.getState().resetResume();
  assert.equal(useResumeStore.getState().resume.experience.length, 0);

  // Simulate restore effect: read (not consume) from sessionStorage
  const restored = readPendingUploadSession(storage);
  assert.ok(restored);
  assert.equal(restored!.resume.experience.length, 1);
  assert.equal(restored!.resume.experience[0]?.company, 'NavCo');
  assert.equal(restored!.resume.education.length, 1);

  // Apply restored data to store
  useResumeStore.getState().setResume(restored!.resume as any);
  assert.equal(useResumeStore.getState().resume.experience.length, 1);
  assert.equal(useResumeStore.getState().resume.summary, 'Data should persist through navigation.');

  // Simulate second navigation (e.g. user refreshes) — data still available
  useResumeStore.getState().resetResume();
  const secondRestore = readPendingUploadSession(storage);
  assert.ok(secondRestore);
  assert.equal(secondRestore!.resume.experience[0]?.role, 'Engineer');

  // Simulate save: clear the pending session
  clearPendingUploadSession(storage);
  assert.equal(readPendingUploadSession(storage), null);
});

test('frontend hydration correctly maps ATS resume with all sections populated', () => {
  useResumeStore.getState().resetResume();

  // Simulate a parse-upload response with all fields populated
  // (what the backend now returns after ligature fix)
  const uploadResult = {
    title: 'Tech Lead / AVP - Full Stack Engineering / Frontend Strategist',
    summary: '10+ years of experience in the IT industry with a strong track record of delivering high-ROI software solutions.',
    skills: ['JavaScript', 'TypeScript', 'React', 'Angular', 'Node.js', 'Express', 'MongoDB', 'PostgreSQL', 'AWS', 'Docker', 'Agile methodologies', 'Java'],
    experience: [
      {
        company: 'Barclays',
        role: 'Tech Lead / AVP',
        startDate: 'Jan 2022',
        endDate: 'Present',
        highlights: ['Led frontend architecture modernization across 3 product lines', 'Mentored team of 8 engineers on React best practices'],
      },
      {
        company: 'Infosys',
        role: 'Senior Frontend Developer',
        startDate: 'Jul 2018',
        endDate: 'Dec 2021',
        highlights: ['Built enterprise dashboard used by 500+ internal users'],
      },
      {
        company: 'TCS',
        role: 'Frontend Developer',
        startDate: 'Jun 2015',
        endDate: 'Jun 2018',
        highlights: ['Developed responsive web applications for banking clients'],
      },
    ],
    education: [
      {
        institution: 'Siddhant College of Engineering, Pune University',
        degree: 'Bachelor of Engineering in Computer Science',
        startDate: '2011',
        endDate: '2015',
        details: [],
      },
    ],
    projects: [],
    certifications: [
      { name: 'AWS Solutions Architect Associate', date: '2023', details: [] },
    ],
    roleLevel: 'SENIOR' as const,
    fileName: 'resume-cmmd1j4ei0001bninaqk7xr1k.pdf',
    parsed: {
      title: 'Tech Lead / AVP - Full Stack Engineering / Frontend Strategist',
      summary: '10+ years of experience in the IT industry with a strong track record of delivering high-ROI software solutions.',
      skills: ['JavaScript', 'TypeScript', 'React', 'Angular', 'Node.js', 'Express', 'MongoDB', 'PostgreSQL', 'AWS', 'Docker', 'Agile methodologies', 'Java'],
      experience: [
        {
          company: 'Barclays',
          role: 'Tech Lead / AVP',
          startDate: 'Jan 2022',
          endDate: 'Present',
          highlights: ['Led frontend architecture modernization across 3 product lines', 'Mentored team of 8 engineers on React best practices'],
        },
        {
          company: 'Infosys',
          role: 'Senior Frontend Developer',
          startDate: 'Jul 2018',
          endDate: 'Dec 2021',
          highlights: ['Built enterprise dashboard used by 500+ internal users'],
        },
        {
          company: 'TCS',
          role: 'Frontend Developer',
          startDate: 'Jun 2015',
          endDate: 'Jun 2018',
          highlights: ['Developed responsive web applications for banking clients'],
        },
      ],
      education: [
        {
          institution: 'Siddhant College of Engineering, Pune University',
          degree: 'Bachelor of Engineering in Computer Science',
          startDate: '2011',
          endDate: '2015',
          details: [],
        },
      ],
      projects: [],
      certifications: [
        { name: 'AWS Solutions Architect Associate', date: '2023', details: [] },
      ],
      roleLevel: 'SENIOR' as const,
    },
  };

  // Build pending session and verify hydration
  const pending = buildPendingUploadSession(uploadResult as any);
  assert.ok(pending.uploadSummary.sectionsPopulated.includes('experience'), 'experience section populated');
  assert.ok(pending.uploadSummary.sectionsPopulated.includes('skills'), 'skills section populated');
  assert.ok(pending.uploadSummary.sectionsPopulated.includes('education'), 'education section populated');
  assert.equal(pending.uploadSummary.companyCount, 3, '3 companies extracted');
  assert.equal(pending.resume.experience.length, 3, '3 experience entries in draft');
  assert.equal(pending.resume.skills.length, 12, '12 skills in draft');
  assert.equal(pending.resume.education.length, 1, '1 education entry in draft');
  assert.equal(pending.resume.certifications.length, 1, '1 certification in draft');

  // Stage in Zustand store
  const storage = new MemoryStorage();
  const nav = continueToReviewFromStart({
    session: pending,
    template: 'modern',
    setResume: useResumeStore.getState().setResume,
    setUploadedFileName: useResumeStore.getState().setUploadedFileName,
    storage,
  });
  assert.equal(nav.enabled, true);

  // Verify Zustand store has full data
  const state = useResumeStore.getState();
  assert.equal(state.resume.experience.length, 3, 'store has 3 experience entries');
  assert.ok(state.resume.experience.some((e) => e.company === 'Barclays'), 'Barclays in store');
  assert.ok(state.resume.experience.some((e) => e.company === 'Infosys'), 'Infosys in store');
  assert.ok(state.resume.experience.some((e) => e.company === 'TCS'), 'TCS in store');
  assert.ok(state.resume.skills.length >= 10, 'skills populated in store');
  assert.equal(state.resume.education.length, 1, 'education populated in store');
  assert.ok(state.resume.summary.includes('10+ years'), 'summary in store');
  assert.equal(state.uploadedFileName, 'resume-cmmd1j4ei0001bninaqk7xr1k.pdf', 'file name in store');
});
