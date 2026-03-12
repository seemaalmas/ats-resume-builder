import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ACTIVE_RESUME_SESSION_KEY, resolveCurrentSessionResumeId } from '../src/lib/resume-flow';

process.env.NEXT_TEST_MOCK_ROUTER = '1';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/dashboard' });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.self = dom.window;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame?.bind(dom.window) ??
  ((callback: FrameRequestCallback) => setTimeout(callback, 0) as unknown as number);

type TestingLib = typeof import('@testing-library/react');
type DashboardPageModule = typeof import('@/app/dashboard/DashboardPageView');
type TemplateSelectionModule = typeof import('@/app/resume/template/TemplateSelectionView');

let testingLibPromise: Promise<TestingLib> | null = null;
let dashboardPagePromise: Promise<DashboardPageModule> | null = null;
let templateSelectionPromise: Promise<TemplateSelectionModule> | null = null;

function getTestingLib() {
  if (!testingLibPromise) {
    testingLibPromise = import('@testing-library/react');
  }
  return testingLibPromise;
}

function getDashboardPageModule() {
  if (!dashboardPagePromise) {
    dashboardPagePromise = import('@/app/dashboard/DashboardPageView');
  }
  return dashboardPagePromise;
}

function getTemplateSelectionModule() {
  if (!templateSelectionPromise) {
    templateSelectionPromise = import('@/app/resume/template/TemplateSelectionView');
  }
  return templateSelectionPromise;
}

test.afterEach(async () => {
  const { cleanup } = await getTestingLib();
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function createApiClient(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    getDriveSession: async () => ({ driveConsentAsked: false, googleConnected: false, driveConnected: false }),
    setDriveConsent: async () => ({ driveConsentAsked: true, googleConnected: false, driveConnected: false }),
    getGoogleStartUrl: async () => ({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=test' }),
    listResumes: async () => ([
      {
        id: 'resume-db-1',
        title: 'DB Resume',
        templateId: 'classic',
        contact: { fullName: 'Database User', email: 'db@example.com' },
        summary: 'From database',
        skills: ['Node.js'],
        technicalSkills: ['Node.js'],
        softSkills: ['Collaboration'],
        languages: ['English'],
        experience: [{ company: 'Acme', role: 'Engineer', startDate: '2022-01', endDate: 'Present', highlights: ['Led modernization program.'] }],
        education: [],
        projects: [],
        certifications: [],
        createdAt: now,
        updatedAt: now,
      },
    ]),
    updateResume: async (id: string, payload: { templateId?: string }) => ({
      id,
      title: 'DB Resume',
      templateId: payload.templateId || 'classic',
      contact: { fullName: 'Database User', email: 'db@example.com' },
      summary: 'From database',
      skills: ['Node.js'],
      technicalSkills: ['Node.js'],
      softSkills: ['Collaboration'],
      languages: ['English'],
      experience: [{ company: 'Acme', role: 'Engineer', startDate: '2022-01', endDate: 'Present', highlights: ['Led modernization program.'] }],
      education: [],
      projects: [],
      certifications: [],
      createdAt: now,
      updatedAt: now,
    }),
    listDriveFiles: async () => ({ files: [] }),
    importDriveFile: async () => ({
      title: 'Imported Resume',
      contact: { fullName: 'Imported User', email: 'imported@example.com' },
      summary: 'Imported summary',
      skills: ['TypeScript'],
      experience: [],
      education: [],
      projects: [],
      certifications: [],
    }),
    extendSession: async () => ({ ok: true }),
    logout: async () => ({ ok: true }),
    ...overrides,
  };
}

function seedAuthenticatedSession() {
  window.localStorage.setItem('accessToken', 'test-access-token');
  window.localStorage.setItem('refreshToken', 'test-refresh-token');
  window.localStorage.setItem('userId', 'user-1');
}

function createSearchParams(params: Record<string, string>) {
  return {
    get: (key: string) => params[key] || null,
  };
}

async function waitForAssertion(assertion: () => void, timeoutMs = 5_000) {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Timed out waiting for assertion');
}

function assertLiveResumeThumbnails(container: HTMLElement, expectedResumeLabel: string) {
  const renderers = Array.from(
    container.querySelectorAll('[data-renderer="resume-template-render"][data-render-mode="thumbnail"]'),
  );
  assert.ok(renderers.length >= 6, 'Expected at least 6 live thumbnail renderers');
  assert.ok(container.querySelectorAll('.template-preview-frame__page').length >= 6, 'Expected full mini-page frames in thumbnails');
  assert.ok(container.querySelectorAll('.ats-template').length >= 6, 'Expected real resume template markup in thumbnails');
  assert.equal(container.querySelector('.template-card__thumbnail-image'), null);
  assert.equal(container.querySelector('iframe'), null);
  assert.equal(container.querySelector('img'), null);
  assert.equal(container.querySelector('[data-thumbnail-component="TemplateCardThumbnailLoading"]'), null);
  assert.ok(container.querySelectorAll('[data-preview-frame-mode="thumbnail"]').length >= 6);

  for (const renderer of renderers) {
    assert.equal(renderer.getAttribute('data-render-component'), 'ResumeTemplateRender');
    assert.equal(renderer.getAttribute('data-resume-source'), 'prop');
    assert.equal(renderer.getAttribute('data-resume-label'), expectedResumeLabel);
  }
}

test('resolveCurrentSessionResumeId ignores session-stored resume ids without an explicit selection', () => {
  window.sessionStorage.setItem(ACTIVE_RESUME_SESSION_KEY, 'resume-db-1');

  assert.equal(resolveCurrentSessionResumeId('', window.sessionStorage), '');
  assert.equal(resolveCurrentSessionResumeId('resume-explicit-1', window.sessionStorage), 'resume-explicit-1');
});

test('dashboard renders template grid with at least 6 templates when a resume exists', async () => {
  seedAuthenticatedSession();
  const { render, screen, waitFor, fireEvent } = await getTestingLib();
  const { default: DashboardPage } = await getDashboardPageModule();

  render(React.createElement(DashboardPage, { apiClient: createApiClient() as any }));

  const profilePreview = await screen.findByTestId('dashboard-preview-profile', undefined, { timeout: 5_000 });
  const select = await screen.findByTestId('dashboard-resume-select', undefined, { timeout: 5_000 }) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'resume-db-1' } });
  await waitFor(() => {
    assert.match(profilePreview.textContent || '', /Database User/i);
  }, { timeout: 5_000 });
  const templateGrid = await screen.findByTestId('dashboard-template-grid', undefined, { timeout: 5_000 });
  assert.ok(templateGrid.querySelectorAll('[data-template-id]').length >= 6);
  assert.ok(templateGrid.querySelectorAll('[data-preview-kind="thumbnail"]').length >= 6);
  assertLiveResumeThumbnails(templateGrid, 'DB Resume');
  assert.equal(templateGrid.querySelector('[data-thumbnail-state="loading"]'), null);
  assert.match(templateGrid.textContent || '', /DB Resume/i);
});

test('dashboard thumbnails always follow the currently selected resume data', async () => {
  seedAuthenticatedSession();
  const { render, screen, fireEvent, waitFor } = await getTestingLib();
  const { default: DashboardPage } = await getDashboardPageModule();

  render(React.createElement(DashboardPage, {
    apiClient: createApiClient({
      listResumes: async () => ([
        {
          id: 'resume-db-1',
          title: 'DB Resume',
          templateId: 'classic',
          contact: { fullName: 'Database User', email: 'db@example.com' },
          summary: 'From database',
          skills: ['Node.js'],
          technicalSkills: ['Node.js'],
          softSkills: ['Collaboration'],
          languages: ['English'],
          experience: [{ company: 'Acme', role: 'Engineer', startDate: '2022-01', endDate: 'Present', highlights: ['Led modernization program.'] }],
          education: [],
          projects: [],
          certifications: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'resume-db-2',
          title: 'Ops Resume',
          templateId: 'technical',
          contact: { fullName: 'Ops User', email: 'ops@example.com' },
          summary: 'Runs platform operations',
          skills: ['Kubernetes'],
          technicalSkills: ['Kubernetes'],
          softSkills: ['Ownership'],
          languages: ['English'],
          experience: [{ company: 'Globex', role: 'Platform Lead', startDate: '2023-01', endDate: 'Present', highlights: ['Scaled the production platform.'] }],
          education: [],
          projects: [],
          certifications: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    }) as any,
  }));

  const select = await screen.findByTestId('dashboard-resume-select', undefined, { timeout: 5_000 }) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'resume-db-1' } });

  const templateGrid = await screen.findByTestId('dashboard-template-grid', undefined, { timeout: 5_000 });
  await waitFor(() => {
    assertLiveResumeThumbnails(templateGrid, 'DB Resume');
  }, { timeout: 5_000 });

  fireEvent.change(select, { target: { value: 'resume-db-2' } });

  await waitFor(() => {
    assertLiveResumeThumbnails(templateGrid, 'Ops Resume');
    assert.doesNotMatch(templateGrid.textContent || '', /DB Resume/i);
    assert.match(templateGrid.textContent || '', /Ops Resume/i);
  }, { timeout: 5_000 });
});

test('consent modal appears once per session and Later keeps the explicitly selected resume visible', async () => {
  seedAuthenticatedSession();
  const { render, waitFor, fireEvent, screen, within } = await getTestingLib();
  const { default: DashboardPage } = await getDashboardPageModule();

  let asked = false;
  const apiClient = createApiClient({
    getDriveSession: async () => ({ driveConsentAsked: asked, googleConnected: false, driveConnected: false }),
    setDriveConsent: async (payload: { decision: 'accepted' | 'declined' }) => {
      if (payload.decision === 'declined') {
        asked = true;
      }
      return { driveConsentAsked: asked, googleConnected: false, driveConnected: false };
    },
  });

  const firstRender = render(React.createElement(DashboardPage, { apiClient: apiClient as any }));
  const consentDialog = await screen.findByTestId('drive-consent-modal', undefined, { timeout: 5_000 });
  fireEvent.click(within(consentDialog).getByRole('button', { name: /Later/i }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(screen.queryByTestId('drive-consent-modal'), null);
  const profilePreview = screen.getByTestId('dashboard-preview-profile');
  const select = screen.getByTestId('dashboard-resume-select') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'resume-db-1' } });
  await waitFor(() => {
    assert.match(profilePreview.textContent || '', /Database User/i);
  }, { timeout: 5_000 });

  firstRender.unmount();
  render(React.createElement(DashboardPage, { apiClient: apiClient as any }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await waitFor(() => {
    assert.equal(screen.queryByTestId('drive-consent-modal'), null);
  }, { timeout: 5_000 });
});

test('Connect Google Drive triggers OAuth redirect flow', async () => {
  seedAuthenticatedSession();
  const { render, waitFor, fireEvent, screen, within } = await getTestingLib();
  const { default: DashboardPage } = await getDashboardPageModule();

  const redirects: string[] = [];
  const apiClient = createApiClient({
    getDriveSession: async () => ({ driveConsentAsked: false, googleConnected: false, driveConnected: false }),
    getGoogleStartUrl: async () => ({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=oauth-1' }),
  });

  render(
    React.createElement(DashboardPage, {
      apiClient: apiClient as any,
      redirectTo: (url: string) => redirects.push(url),
    }),
  );

  const modal = await screen.findByTestId('drive-consent-modal', undefined, { timeout: 5_000 });
  fireEvent.click(within(modal).getByRole('button', { name: /^Connect$/i }));

  await waitFor(() => {
    assert.equal(redirects.length, 1);
    assert.match(redirects[0], /^https:\/\/accounts\.google\.com\//);
  }, { timeout: 5_000 });
});

test('dashboard template Preview click persists and navigates to /resume/template?resumeId=<id>', async () => {
  seedAuthenticatedSession();
  const { render, waitFor, screen, fireEvent } = await getTestingLib();
  const { default: DashboardPage } = await getDashboardPageModule();
  const pushes: string[] = [];
  const updates: Array<{ id: string; templateId?: string }> = [];
  const apiClient = createApiClient({
    updateResume: async (id: string, payload: { templateId?: string }) => {
      updates.push({ id, templateId: payload.templateId });
      return {
        ...(await (createApiClient().updateResume as any)(id, payload)),
      };
    },
  });

  render(
    React.createElement(DashboardPage, {
      apiClient: apiClient as any,
      routerOverride: { push: (href: string) => pushes.push(href) },
    }),
  );

  const select = await screen.findByTestId('dashboard-resume-select', undefined, { timeout: 5_000 }) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'resume-db-1' } });

  const grid = await screen.findByTestId('dashboard-template-grid', undefined, { timeout: 5_000 });
  const firstCard = grid.querySelector('[data-template-id]') as HTMLElement | null;
  const firstTemplateId = firstCard?.getAttribute('data-template-id') || '';
  const firstPreviewButton = Array.from(grid.querySelectorAll('button')).find((button) => /preview/i.test(button.textContent || '')) as HTMLButtonElement | undefined;
  assert.ok(firstPreviewButton, 'Expected at least one Preview button');
  fireEvent.click(firstPreviewButton);

  await waitFor(() => {
    assert.equal(updates.length, 0);
    assert.equal(pushes.includes(`/resume/template?resumeId=resume-db-1&template=${firstTemplateId}`), true);
  }, { timeout: 5_000 });
});

test('dashboard gallery uses compact gallery variant for template cards', async () => {
  seedAuthenticatedSession();
  const { render, screen, fireEvent } = await getTestingLib();
  const { default: DashboardPage } = await getDashboardPageModule();

  render(React.createElement(DashboardPage, { apiClient: createApiClient() as any }));

  const select = await screen.findByTestId('dashboard-resume-select', undefined, { timeout: 5_000 }) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'resume-db-1' } });
  const templateGrid = await screen.findByTestId('dashboard-template-grid', undefined, { timeout: 5_000 });
  assert.equal(templateGrid.getAttribute('data-layout-variant'), 'gallery');
  assert.ok(templateGrid.querySelector('.template-preview-frame__container'));
  assert.ok(templateGrid.querySelector('[data-render-mode="thumbnail"]'));
  assertLiveResumeThumbnails(templateGrid, 'DB Resume');
  assert.equal(templateGrid.querySelector('[data-thumbnail-state="loading"]'), null);
});

test('dashboard does not auto-select a saved resume in a fresh session', async () => {
  seedAuthenticatedSession();
  const { render, screen } = await getTestingLib();
  const { default: DashboardPage } = await getDashboardPageModule();

  render(React.createElement(DashboardPage, { apiClient: createApiClient() as any }));

  const profilePreview = await screen.findByTestId('dashboard-preview-profile', undefined, { timeout: 5_000 });
  assert.match(profilePreview.textContent || '', /No resume selected/i);
  assert.doesNotMatch(profilePreview.textContent || '', /Database User/i);
  const select = screen.getByTestId('dashboard-resume-select') as HTMLSelectElement;
  assert.equal(select.value, '');
});

test('dashboard ignores stale session resume ids until a user explicitly selects a resume', async () => {
  seedAuthenticatedSession();
  window.sessionStorage.setItem(ACTIVE_RESUME_SESSION_KEY, 'resume-db-1');
  const { render, screen } = await getTestingLib();
  const { default: DashboardPage } = await getDashboardPageModule();

  render(React.createElement(DashboardPage, { apiClient: createApiClient() as any }));

  const profilePreview = await screen.findByTestId('dashboard-preview-profile', undefined, { timeout: 5_000 });
  assert.match(profilePreview.textContent || '', /No resume selected/i);
  assert.doesNotMatch(profilePreview.textContent || '', /Database User/i);
  const select = screen.getByTestId('dashboard-resume-select') as HTMLSelectElement;
  assert.equal(select.value, '');
});

test('dashboard highlights the saved template only after explicit resume selection', async () => {
  seedAuthenticatedSession();
  const { render, screen, fireEvent, waitFor } = await getTestingLib();
  const { default: DashboardPage } = await getDashboardPageModule();

  render(React.createElement(DashboardPage, {
    apiClient: createApiClient({
      listResumes: async () => ([
        {
          id: 'resume-db-1',
          title: 'DB Resume',
          templateId: 'executive',
          contact: { fullName: 'Database User', email: 'db@example.com' },
          summary: '',
          skills: [],
          technicalSkills: [],
          softSkills: [],
          languages: [],
          experience: [],
          education: [],
          projects: [],
          certifications: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    }) as any,
  }));

  const select = await screen.findByTestId('dashboard-resume-select', undefined, { timeout: 5_000 }) as HTMLSelectElement;
  assert.equal(select.value, '');
  fireEvent.change(select, { target: { value: 'resume-db-1' } });

  await waitFor(() => {
    const appliedCard = document.querySelector('[data-template-id="executive"]');
    assert.ok(appliedCard, 'Expected executive template card to exist');
    assert.equal(appliedCard?.classList.contains('active'), true);
  }, { timeout: 5_000 });
});

test('dashboard shows Applied only for the actively selected resume', async () => {
  seedAuthenticatedSession();
  const { render, screen, fireEvent, waitFor } = await getTestingLib();
  const { default: DashboardPage } = await getDashboardPageModule();

  render(React.createElement(DashboardPage, {
    apiClient: createApiClient({
      listResumes: async () => ([
        {
          id: 'resume-db-1',
          title: 'DB Resume',
          templateId: 'executive',
          contact: { fullName: 'Database User', email: 'db@example.com' },
          summary: 'From database',
          skills: ['Node.js'],
          technicalSkills: ['Node.js'],
          softSkills: ['Collaboration'],
          languages: ['English'],
          experience: [{ company: 'Acme', role: 'Engineer', startDate: '2022-01', endDate: 'Present', highlights: ['Led modernization program.'] }],
          education: [],
          projects: [],
          certifications: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'resume-db-2',
          title: 'Ops Resume',
          templateId: 'technical',
          contact: { fullName: 'Ops User', email: 'ops@example.com' },
          summary: '',
          skills: [],
          technicalSkills: [],
          softSkills: [],
          languages: [],
          experience: [],
          education: [],
          projects: [],
          certifications: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    }) as any,
  }));

  assert.equal(screen.queryByTestId('dashboard-template-grid'), null);

  const select = await screen.findByTestId('dashboard-resume-select', undefined, { timeout: 5_000 }) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'resume-db-1' } });

  await waitForAssertion(() => {
    const templateGrid = screen.getByTestId('dashboard-template-grid');
    const executiveCard = templateGrid.querySelector('[data-template-id="executive"]');
    const technicalCard = templateGrid.querySelector('[data-template-id="technical"]');
    assert.equal(executiveCard?.classList.contains('active'), true);
    assert.equal(technicalCard?.classList.contains('active'), false);
  });

  fireEvent.change(select, { target: { value: 'resume-db-2' } });

  await waitForAssertion(() => {
    const templateGrid = screen.getByTestId('dashboard-template-grid');
    const executiveCard = templateGrid.querySelector('[data-template-id="executive"]');
    const technicalCard = templateGrid.querySelector('[data-template-id="technical"]');
    assert.equal(executiveCard?.classList.contains('active'), false);
    assert.equal(technicalCard?.classList.contains('active'), true);
  });
});

test('/resume/template stays empty without an explicit resumeId even when session storage has a stale selection', async () => {
  seedAuthenticatedSession();
  window.sessionStorage.setItem(ACTIVE_RESUME_SESSION_KEY, 'resume-db-1');
  const { render, screen } = await getTestingLib();
  const { default: TemplateSelectionView } = await getTemplateSelectionModule();

  render(
    React.createElement(TemplateSelectionView, {
      apiClient: {
        getResume: async () => { throw new Error('should not load resume'); },
        updateResume: async () => { throw new Error('should not update resume'); },
        ingestResume: async () => { throw new Error('should not upload resume'); },
        downloadPdf: async () => undefined,
      } as any,
      searchParamsOverride: createSearchParams({}),
      routerOverride: { push: async () => true },
    }),
  );

  const emptyState = await screen.findByText(/Select a saved resume or upload a new one to preview templates\./i, undefined, { timeout: 5_000 });
  assert.ok(emptyState);
});

test('reopening dashboard after clearing session keeps saved resumes visible but does not auto-preview stale content', async () => {
  seedAuthenticatedSession();
  const { render, screen, fireEvent } = await getTestingLib();
  const { default: DashboardPage } = await getDashboardPageModule();

  const firstRender = render(React.createElement(DashboardPage, { apiClient: createApiClient() as any }));
  const select = await screen.findByTestId('dashboard-resume-select', undefined, { timeout: 5_000 }) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'resume-db-1' } });
  firstRender.unmount();

  window.sessionStorage.clear();

  render(React.createElement(DashboardPage, { apiClient: createApiClient() as any }));
  const profilePreview = await screen.findByTestId('dashboard-preview-profile', undefined, { timeout: 5_000 });
  assert.match(profilePreview.textContent || '', /No resume selected/i);
  assert.doesNotMatch(profilePreview.textContent || '', /Database User/i);
  const reopenedSelect = screen.getByTestId('dashboard-resume-select') as HTMLSelectElement;
  assert.equal(reopenedSelect.value, '');
});

test('/resume/template honors selected template query and refreshes preview after upload', async () => {
  seedAuthenticatedSession();
  const { render, screen, fireEvent, waitFor } = await getTestingLib();
  const { default: TemplateSelectionView } = await getTemplateSelectionModule();

  const now = new Date().toISOString();
  const apiClient = {
    getResume: async () => ({
      id: 'resume-db-1',
      title: 'DB Resume',
      templateId: 'classic',
      contact: { fullName: 'Database User', email: 'db@example.com' },
      summary: 'From database',
      skills: ['Node.js'],
      technicalSkills: ['Node.js'],
      softSkills: ['Collaboration'],
      languages: ['English'],
      experience: [{ company: 'Acme', role: 'Engineer', startDate: '2022-01', endDate: 'Present', highlights: ['Led modernization program.'] }],
      education: [],
      projects: [],
      certifications: [],
      createdAt: now,
      updatedAt: now,
    }),
    updateResume: async () => ({
      id: 'resume-db-1',
      title: 'DB Resume',
      templateId: 'modern',
      contact: { fullName: 'Database User', email: 'db@example.com' },
      summary: 'From database',
      skills: ['Node.js'],
      technicalSkills: ['Node.js'],
      softSkills: ['Collaboration'],
      languages: ['English'],
      experience: [{ company: 'Acme', role: 'Engineer', startDate: '2022-01', endDate: 'Present', highlights: ['Led modernization program.'] }],
      education: [],
      projects: [],
      certifications: [],
      createdAt: now,
      updatedAt: now,
    }),
    ingestResume: async () => ({
      resume: {
        id: 'resume-db-1',
        title: 'Uploaded Resume',
        templateId: 'classic',
        contact: { fullName: 'Uploaded User', email: 'uploaded@example.com' },
        summary: 'Uploaded summary',
        skills: ['TypeScript'],
        technicalSkills: ['TypeScript'],
        softSkills: ['Leadership'],
        languages: ['English'],
        experience: [{ company: 'Globex', role: 'Lead Engineer', startDate: '2023-01', endDate: 'Present', highlights: ['Owned platform modernization.'] }],
        education: [],
        projects: [],
        certifications: [],
        createdAt: now,
        updatedAt: now,
      },
      mapped: {
        title: 'Uploaded Resume',
        contact: { fullName: 'Uploaded User', email: 'uploaded@example.com' },
        summary: 'Uploaded summary',
        skills: ['TypeScript'],
        technicalSkills: ['TypeScript'],
        softSkills: ['Leadership'],
        languages: ['English'],
        experience: [{ company: 'Globex', role: 'Lead Engineer', startDate: '2023-01', endDate: 'Present', highlights: ['Owned platform modernization.'] }],
        education: [],
        projects: [],
        certifications: [],
      },
      signals: {
        roleCount: 1,
        distinctCompanyCount: 1,
        rolesWithDateCount: 1,
        roleCompanyPatternCount: 1,
        estimatedTotalMonths: 24,
      },
    }),
    downloadPdf: async () => undefined,
  };

  render(
    React.createElement(TemplateSelectionView, {
      apiClient: apiClient as any,
      searchParamsOverride: createSearchParams({ resumeId: 'resume-db-1', template: 'modern' }),
      routerOverride: { push: async () => true },
    }),
  );

  const preview = await screen.findByTestId('template-selection-preview', undefined, { timeout: 5_000 });
  const templateGrid = await screen.findByTestId('template-selection-grid', undefined, { timeout: 5_000 });
  assert.equal(preview.getAttribute('data-active-template'), 'modern');
  assert.ok(templateGrid.querySelector('[data-preview-kind="thumbnail"]'));
  assertLiveResumeThumbnails(templateGrid, 'DB Resume');
  assert.equal(templateGrid.querySelector('[data-thumbnail-state="loading"]'), null);
  assert.match(templateGrid.textContent || '', /DB Resume/i);
  assert.ok(preview.querySelector('.template-preview-frame__container'));
  await waitFor(() => {
    assert.match(preview.textContent || '', /DB Resume/i);
  }, { timeout: 5_000 });

  const uploadInput = screen.getByTestId('template-upload-input') as HTMLInputElement;
  fireEvent.change(uploadInput, {
    target: {
      files: [new File(['updated resume'], 'updated-resume.pdf', { type: 'application/pdf' })],
    },
  });

  await waitFor(() => {
    assert.match(preview.textContent || '', /Uploaded Resume/i);
    assert.equal(preview.getAttribute('data-active-template'), 'modern');
    assert.match(templateGrid.textContent || '', /Uploaded Resume/i);
    assertLiveResumeThumbnails(templateGrid, 'Uploaded Resume');
  }, { timeout: 5_000 });
});

test('/resume/template uses placeholder thumbnails only while loading and replaces them with real mini pages', async () => {
  seedAuthenticatedSession();
  const { render, screen, waitFor } = await getTestingLib();
  const { default: TemplateSelectionView } = await getTemplateSelectionModule();

  const now = new Date().toISOString();
  let resolveResume: ((value: Record<string, unknown>) => void) | null = null;
  const resumePromise = new Promise<Record<string, unknown>>((resolve) => {
    resolveResume = resolve;
  });

  render(
    React.createElement(TemplateSelectionView, {
      apiClient: {
        getResume: async () => resumePromise as any,
        updateResume: async () => {
          throw new Error('should not save in loading-state test');
        },
        ingestResume: async () => {
          throw new Error('should not upload in loading-state test');
        },
        downloadPdf: async () => undefined,
      } as any,
      searchParamsOverride: createSearchParams({ resumeId: 'resume-db-1', template: 'classic' }),
      routerOverride: { push: async () => true },
    }),
  );

  const templateGrid = await screen.findByTestId('template-selection-grid', undefined, { timeout: 5_000 });
  await waitFor(() => {
    assert.ok(templateGrid.querySelectorAll('[data-thumbnail-component="TemplateCardThumbnailLoading"]').length >= 6);
  }, { timeout: 5_000 });

  resolveResume?.({
    id: 'resume-db-1',
    title: 'DB Resume',
    templateId: 'classic',
    contact: { fullName: 'Database User', email: 'db@example.com' },
    summary: 'From database',
    skills: ['Node.js'],
    technicalSkills: ['Node.js'],
    softSkills: ['Collaboration'],
    languages: ['English'],
    experience: [{ company: 'Acme', role: 'Engineer', startDate: '2022-01', endDate: 'Present', highlights: ['Led modernization program.'] }],
    education: [],
    projects: [],
    certifications: [],
    createdAt: now,
    updatedAt: now,
  });

  await waitFor(() => {
    assert.equal(templateGrid.querySelector('[data-thumbnail-component="TemplateCardThumbnailLoading"]'), null);
    assertLiveResumeThumbnails(templateGrid, 'DB Resume');
  }, { timeout: 5_000 });
});

test('/resume/template clicking a template card updates the selected live preview', async () => {
  seedAuthenticatedSession();
  const { render, screen, fireEvent, waitFor } = await getTestingLib();
  const { default: TemplateSelectionView } = await getTemplateSelectionModule();

  const now = new Date().toISOString();
  render(
    React.createElement(TemplateSelectionView, {
      apiClient: {
        getResume: async () => ({
          id: 'resume-db-1',
          title: 'DB Resume',
          templateId: 'classic',
          contact: { fullName: 'Database User', email: 'db@example.com' },
          summary: 'From database',
          skills: ['Node.js'],
          technicalSkills: ['Node.js'],
          softSkills: ['Collaboration'],
          languages: ['English'],
          experience: [{ company: 'Acme', role: 'Engineer', startDate: '2022-01', endDate: 'Present', highlights: ['Led modernization program.'] }],
          education: [],
          projects: [],
          certifications: [],
          createdAt: now,
          updatedAt: now,
        }),
        updateResume: async () => {
          throw new Error('should not save while previewing');
        },
        ingestResume: async () => {
          throw new Error('should not upload in this test');
        },
        downloadPdf: async () => undefined,
      } as any,
      searchParamsOverride: createSearchParams({ resumeId: 'resume-db-1', template: 'classic' }),
      routerOverride: { push: async () => true },
    }),
  );

  const preview = await screen.findByTestId('template-selection-preview', undefined, { timeout: 5_000 });
  const templateGrid = await screen.findByTestId('template-selection-grid', undefined, { timeout: 5_000 });
  const technicalPreviewCard = templateGrid.querySelector('[data-template-id="technical"] .template-card__preview') as HTMLElement | null;
  assert.ok(technicalPreviewCard, 'Expected technical template preview card');

  fireEvent.click(technicalPreviewCard);

  await waitFor(() => {
    assert.equal(preview.getAttribute('data-active-template'), 'technical');
    const technicalCard = templateGrid.querySelector('[data-template-id="technical"]');
    assert.equal(technicalCard?.classList.contains('active'), true);
  }, { timeout: 5_000 });
});

test('dashboard does not render final template cards before a resume is selected', async () => {
  seedAuthenticatedSession();
  const { render, screen } = await getTestingLib();
  const { default: DashboardPage } = await getDashboardPageModule();

  render(React.createElement(DashboardPage, { apiClient: createApiClient() as any }));

  await screen.findByTestId('dashboard-preview-profile', undefined, { timeout: 5_000 });
  assert.equal(screen.queryByTestId('dashboard-template-grid'), null);
  assert.equal(screen.queryByRole('button', { name: /Preview/i }), null);
});

test('/resume/template keeps the uploaded resume preview after saving the selected template', async () => {
  seedAuthenticatedSession();
  const { render, screen, fireEvent, waitFor } = await getTestingLib();
  const { default: TemplateSelectionView } = await getTemplateSelectionModule();

  const now = new Date().toISOString();
  const apiClient = {
    getResume: async () => ({
      id: 'resume-db-1',
      title: 'DB Resume',
      templateId: 'classic',
      contact: { fullName: 'Database User', email: 'db@example.com' },
      summary: 'From database',
      skills: ['Node.js'],
      technicalSkills: ['Node.js'],
      softSkills: ['Collaboration'],
      languages: ['English'],
      experience: [{ company: 'Acme', role: 'Engineer', startDate: '2022-01', endDate: 'Present', highlights: ['Led modernization program.'] }],
      education: [],
      projects: [],
      certifications: [],
      createdAt: now,
      updatedAt: now,
    }),
    updateResume: async () => ({
      id: 'resume-db-1',
      title: 'DB Resume',
      templateId: 'modern',
      contact: { fullName: 'Database User', email: 'db@example.com' },
      summary: 'From database',
      skills: ['Node.js'],
      technicalSkills: ['Node.js'],
      softSkills: ['Collaboration'],
      languages: ['English'],
      experience: [{ company: 'Acme', role: 'Engineer', startDate: '2022-01', endDate: 'Present', highlights: ['Led modernization program.'] }],
      education: [],
      projects: [],
      certifications: [],
      createdAt: now,
      updatedAt: now,
    }),
    ingestResume: async () => ({
      resume: {
        id: 'resume-db-1',
        title: 'Uploaded Resume',
        templateId: 'classic',
        contact: { fullName: 'Uploaded User', email: 'uploaded@example.com' },
        summary: 'Uploaded summary',
        skills: ['TypeScript'],
        technicalSkills: ['TypeScript'],
        softSkills: ['Leadership'],
        languages: ['English'],
        experience: [{ company: 'Globex', role: 'Lead Engineer', startDate: '2023-01', endDate: 'Present', highlights: ['Owned platform modernization.'] }],
        education: [],
        projects: [],
        certifications: [],
        createdAt: now,
        updatedAt: now,
      },
      mapped: {
        title: 'Uploaded Resume',
        contact: { fullName: 'Uploaded User', email: 'uploaded@example.com' },
        summary: 'Uploaded summary',
        skills: ['TypeScript'],
        technicalSkills: ['TypeScript'],
        softSkills: ['Leadership'],
        languages: ['English'],
        experience: [{ company: 'Globex', role: 'Lead Engineer', startDate: '2023-01', endDate: 'Present', highlights: ['Owned platform modernization.'] }],
        education: [],
        projects: [],
        certifications: [],
      },
      signals: {
        roleCount: 1,
        distinctCompanyCount: 1,
        rolesWithDateCount: 1,
        roleCompanyPatternCount: 1,
        estimatedTotalMonths: 24,
      },
    }),
    downloadPdf: async () => undefined,
  };

  render(
    React.createElement(TemplateSelectionView, {
      apiClient: apiClient as any,
      searchParamsOverride: createSearchParams({ resumeId: 'resume-db-1', template: 'modern' }),
      routerOverride: { push: async () => true },
    }),
  );

  const preview = await screen.findByTestId('template-selection-preview', undefined, { timeout: 5_000 });
  await waitFor(() => {
    assert.match(preview.textContent || '', /DB Resume/i);
  }, { timeout: 5_000 });

  const uploadInput = screen.getByTestId('template-upload-input') as HTMLInputElement;
  fireEvent.change(uploadInput, {
    target: {
      files: [new File(['updated resume'], 'updated-resume.pdf', { type: 'application/pdf' })],
    },
  });

  await waitFor(() => {
    assert.match(preview.textContent || '', /Uploaded Resume/i);
    assert.equal(preview.getAttribute('data-active-template'), 'modern');
  }, { timeout: 5_000 });

  fireEvent.click(screen.getByRole('button', { name: /Use Template/i }));

  await waitFor(() => {
    assert.match(preview.textContent || '', /Uploaded Resume/i);
    assert.match(preview.textContent || '', /Applied/i);
    assert.equal(preview.getAttribute('data-active-template'), 'modern');
  }, { timeout: 5_000 });
});

test('dashboard and template selection import shared TEMPLATE_CATALOG source', () => {
  const dashboardSource = readFileSync(path.join(__dirname, '..', 'app', 'dashboard', 'DashboardPageView.tsx'), 'utf-8');
  const templateSelectionSource = readFileSync(path.join(__dirname, '..', 'app', 'resume', 'template', 'TemplateSelectionView.tsx'), 'utf-8');
  assert(
    dashboardSource.includes("import { TEMPLATE_CATALOG } from 'resume-builder-shared'"),
    'Dashboard should import catalog from shared package',
  );
  assert(
    templateSelectionSource.includes("import { TEMPLATE_CATALOG } from 'resume-builder-shared'"),
    'Template selection should import catalog from shared package',
  );
});
