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

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  window.localStorage.clear();
});

test('requestOtp calls /auth/otp/send with phone payload', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ requestId: 'req-100' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const result = await api.requestOtp('+919999999991');

  assert.equal(result.requestId, 'req-100');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:3000/auth/otp/send');
  assert.equal(String(calls[0].init?.method || ''), 'POST');
  const payload = JSON.parse(String(calls[0].init?.body || '{}'));
  assert.equal(payload.phone, '+919999999991');
});

test('verifyOtp calls /auth/otp/verify with requestId and stores tokens', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        user: { id: 'user-1', email: 'otp@example.com', fullName: 'Otp User' },
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }) as typeof fetch;

  await api.verifyOtp({ phone: '+919999999992', code: '123456', requestId: 'req-200' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:3000/auth/otp/verify');
  assert.equal(String(calls[0].init?.method || ''), 'POST');
  const payload = JSON.parse(String(calls[0].init?.body || '{}'));
  assert.equal(payload.phone, '+919999999992');
  assert.equal(payload.code, '123456');
  assert.equal(payload.requestId, 'req-200');
  assert.equal(window.localStorage.getItem('accessToken'), 'access-1');
  assert.equal(window.localStorage.getItem('refreshToken'), 'refresh-1');
  assert.equal(window.localStorage.getItem('userId'), 'user-1');
});
