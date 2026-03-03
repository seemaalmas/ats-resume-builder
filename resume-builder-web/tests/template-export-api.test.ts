import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { api } from '../src/lib/api';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.self = dom.window;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.localStorage = dom.window.localStorage;

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  window.localStorage.clear();
});

test('template selection page persists selected templateId on save', () => {
  const source = readFileSync(
    path.join(__dirname, '..', 'app', 'resume', 'template', 'TemplateSelectionView.tsx'),
    'utf-8',
  );
  assert(
    source.includes('api.updateResume(resumeId, { templateId: selectedTemplate })'),
    'Template selection save must persist templateId via updateResume',
  );
});

test('dashboard apply persists templateId before template-route navigation', () => {
  const source = readFileSync(
    path.join(__dirname, '..', 'app', 'dashboard', 'page.tsx'),
    'utf-8',
  );
  assert(
    source.includes('api.updateResume(previewResume.id, { templateId })'),
    'Dashboard apply must persist templateId using updateResume',
  );
  assert(
    source.includes('router.push(buildTemplateSelectionRoute(previewResume.id))'),
    'Dashboard apply should navigate after persistence',
  );
});

test('resume export waits for template persistence before download', () => {
  const source = readFileSync(
    path.join(__dirname, '..', 'app', 'resume', 'ResumeEditor.tsx'),
    'utf-8',
  );
  assert(
    source.includes('await ensureTemplateSavedForExport();'),
    'Resume export should await template persistence before download/preview',
  );
  assert(
    source.includes('await api.downloadPdf(resumeId, exportTemplateId);'),
    'Resume export should call downloadPdf with resolved templateId after save guard',
  );
});

test('template selection view restores applied template from persisted resume.templateId', () => {
  const source = readFileSync(
    path.join(__dirname, '..', 'app', 'resume', 'template', 'TemplateSelectionView.tsx'),
    'utf-8',
  );
  assert(
    source.includes("setSelectedTemplate(resolveTemplateId(data.templateId || '', 'classic'))"),
    'Template selection page should initialize Applied state from persisted templateId',
  );
});

test('updateResume sends templateId in PATCH payload for template persistence', async () => {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        id: 'resume-42',
        templateId: 'modern',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }) as typeof fetch;

  await api.updateResume('resume-42', { templateId: 'modern' });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'http://localhost:3000/resumes/resume-42');
  assert.equal(String(fetchCalls[0].init?.method || ''), 'PATCH');
  const payload = JSON.parse(String(fetchCalls[0].init?.body || '{}'));
  assert.equal(payload.templateId, 'modern');
});

test('downloadPdf calls /resumes/:id/pdf endpoint and triggers browser download flow', async () => {
  window.localStorage.setItem('accessToken', 'token-123');

  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    return new Response('pdf-bytes', {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    });
  }) as typeof fetch;

  let clicked = false;
  let createObjectUrlCalls = 0;
  let revokeObjectUrlCalls = 0;

  const originalCreateObjectURL = (window.URL as any).createObjectURL;
  const originalRevokeObjectURL = (window.URL as any).revokeObjectURL;
  const originalAnchorClick = window.HTMLAnchorElement.prototype.click;

  (window.URL as any).createObjectURL = () => {
    createObjectUrlCalls += 1;
    return 'blob:resume-test';
  };
  (window.URL as any).revokeObjectURL = () => {
    revokeObjectUrlCalls += 1;
  };
  window.HTMLAnchorElement.prototype.click = function click() {
    clicked = true;
  };

  try {
    await api.downloadPdf('resume-77');
  } finally {
    (window.URL as any).createObjectURL = originalCreateObjectURL;
    (window.URL as any).revokeObjectURL = originalRevokeObjectURL;
    window.HTMLAnchorElement.prototype.click = originalAnchorClick;
  }

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'http://localhost:3000/resumes/resume-77/pdf');
  assert.equal(String(fetchCalls[0].init?.method || ''), 'GET');
  const headers = (fetchCalls[0].init?.headers || {}) as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer token-123');
  assert.equal(clicked, true);
  assert.equal(createObjectUrlCalls, 1);
  assert.equal(revokeObjectUrlCalls, 1);
});

test('downloadPdf includes templateId query when provided', async () => {
  window.localStorage.setItem('accessToken', 'token-123');

  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    return new Response('pdf-bytes', {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    });
  }) as typeof fetch;

  const originalCreateObjectURL = (window.URL as any).createObjectURL;
  const originalRevokeObjectURL = (window.URL as any).revokeObjectURL;
  const originalAnchorClick = window.HTMLAnchorElement.prototype.click;
  (window.URL as any).createObjectURL = () => 'blob:resume-test';
  (window.URL as any).revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function click() {};

  try {
    await api.downloadPdf('resume-77', 'executive');
  } finally {
    (window.URL as any).createObjectURL = originalCreateObjectURL;
    (window.URL as any).revokeObjectURL = originalRevokeObjectURL;
    window.HTMLAnchorElement.prototype.click = originalAnchorClick;
  }

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'http://localhost:3000/resumes/resume-77/pdf?templateId=executive');
  assert.equal(String(fetchCalls[0].init?.method || ''), 'GET');
});
