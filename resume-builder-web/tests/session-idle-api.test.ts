import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { api } from '../src/lib/api';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.self = dom.window;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Event = dom.window.Event as unknown as typeof Event;
globalThis.localStorage = dom.window.localStorage;

const originalFetch = globalThis.fetch;

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildJwt(payload: Record<string, unknown>) {
  const header = encodeBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = encodeBase64Url(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  window.localStorage.clear();
});

test('authenticated request refreshes session first when token is near expiry', async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSoon = nowSec + 30;
  const refreshedExp = nowSec + 1800;
  const oldAccess = buildJwt({ sub: 'user-1', typ: 'access', exp: expSoon, iat: nowSec - 100 });
  const newAccess = buildJwt({ sub: 'user-1', typ: 'access', exp: refreshedExp, iat: nowSec });

  window.localStorage.setItem('accessToken', oldAccess);
  window.localStorage.setItem('refreshToken', 'refresh-old');
  window.localStorage.setItem('userId', 'user-1');
  window.localStorage.setItem('sessionExpiresAt', new Date(expSoon * 1000).toISOString());
  window.localStorage.setItem('sessionLastActivityAt', String(Date.now()));

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/auth/refresh')) {
      return new Response(
        JSON.stringify({
          user: { id: 'user-1', email: 'otp@example.com', fullName: 'Otp User' },
          accessToken: newAccess,
          refreshToken: 'refresh-new',
          expiresAt: new Date(refreshedExp * 1000).toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const resumes = await api.listResumes();
  assert.deepEqual(resumes, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'http://localhost:3000/auth/refresh');
  assert.equal(calls[1].url, 'http://localhost:3000/resumes');
  const headers = calls[1].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${newAccess}`);
  assert.equal(window.localStorage.getItem('refreshToken'), 'refresh-new');
});

test('authenticated request clears local auth when idle timeout is exceeded', async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const access = buildJwt({ sub: 'user-1', typ: 'access', exp: nowSec + 3600, iat: nowSec - 100 });
  window.localStorage.setItem('accessToken', access);
  window.localStorage.setItem('refreshToken', 'refresh-old');
  window.localStorage.setItem('userId', 'user-1');
  window.localStorage.setItem('sessionExpiresAt', new Date((nowSec + 3600) * 1000).toISOString());
  window.localStorage.setItem('sessionLastActivityAt', String(Date.now() - 31 * 60 * 1000));

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const resumes = await api.listResumes();
  assert.deepEqual(resumes, []);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
  assert.equal(window.localStorage.getItem('accessToken'), null);
  assert.equal(window.localStorage.getItem('refreshToken'), null);
});
