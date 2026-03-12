import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';

process.env.NEXT_TEST_MOCK_ROUTER = '1';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.self = dom.window;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame?.bind(dom.window) ??
  ((callback: FrameRequestCallback) => setTimeout(callback, 0) as unknown as number);

type TestingLib = typeof import('@testing-library/react');
type LoginPageModule = typeof import('@/app/auth/login/LoginPageView');

let testingLibPromise: Promise<TestingLib> | null = null;
let loginPagePromise: Promise<LoginPageModule> | null = null;

function getTestingLib() {
  if (!testingLibPromise) {
    testingLibPromise = import('@testing-library/react');
  }
  return testingLibPromise;
}

function getLoginPageModule() {
  if (!loginPagePromise) {
    loginPagePromise = import('@/app/auth/login/LoginPageView');
  }
  return loginPagePromise;
}

test.afterEach(async () => {
  const { cleanup } = await getTestingLib();
  cleanup();
});

test('login page renders phone input by default', async () => {
  const { render } = await getTestingLib();
  const { LoginPageView } = await getLoginPageModule();
  const apiClient = {
    requestOtp: async () => ({ requestId: 'req-1' }),
    verifyOtp: async () => ({ user: { id: '1', email: 'a', fullName: 'b' }, accessToken: 'a', refreshToken: 'r' }),
    login: async () => {},
  };

  const view = render(React.createElement(LoginPageView, { apiClient: apiClient as any }));
  const mobileInput = view.getByLabelText(/mobile number/i) as HTMLInputElement;
  assert.equal(mobileInput.id, 'otp-mobile');
});

test('request OTP button calls API', async () => {
  const { render, fireEvent, waitFor } = await getTestingLib();
  const { LoginPageView } = await getLoginPageModule();
  const requestCalls: string[] = [];
  const apiClient = {
    requestOtp: async (mobile: string) => {
      requestCalls.push(mobile);
      return { requestId: 'req-1' };
    },
    verifyOtp: async () => ({ user: { id: '1', email: 'a', fullName: 'b' }, accessToken: 'a', refreshToken: 'r' }),
    login: async () => {},
  };
  const view = render(React.createElement(LoginPageView, { apiClient: apiClient as any }));
  const mobileInput = view.getByLabelText(/mobile number/i) as HTMLInputElement;
  fireEvent.input(mobileInput, { target: { value: '9123456780' } });
  fireEvent.click(view.getByRole('button', { name: /send otp/i }));
  await waitFor(() => {
    assert.equal(requestCalls.length, 1);
    assert.equal(requestCalls[0], '9123456780');
  });
});

test('verify OTP calls API and navigates on success', async () => {
  const { render, fireEvent, waitFor } = await getTestingLib();
  const { LoginPageView } = await getLoginPageModule();
  const verifyCalls: Array<{ phone: string; code: string; requestId: string }> = [];
  const apiClient = {
    requestOtp: async () => ({ requestId: 'req-7' }),
    verifyOtp: async (payload: { phone: string; code: string; requestId: string }) => {
      verifyCalls.push(payload);
      return { user: { id: '1', email: 'a', fullName: 'b' }, accessToken: 'a', refreshToken: 'r' };
    },
    login: async () => {},
  };
  const routerHits: string[] = [];
  const routerStub = {
    push: async (href: string) => {
      routerHits.push(href);
      return true;
    },
  };
  const view = render(React.createElement(LoginPageView, { apiClient: apiClient as any, routerOverride: routerStub }));
  const mobileInput = view.getByLabelText(/mobile number/i) as HTMLInputElement;
  fireEvent.input(mobileInput, { target: { value: '9123456781' } });
  fireEvent.click(view.getByRole('button', { name: /send otp/i }));
  await waitFor(() => view.getByLabelText(/enter otp/i));
  fireEvent.change(view.getByLabelText(/enter otp/i), { target: { value: '123456' } });
  fireEvent.click(view.getByRole('button', { name: /verify & login/i }));
  await waitFor(() => {
    assert.equal(verifyCalls.length, 1);
    assert.equal(verifyCalls[0].phone, '9123456781');
    assert.equal(verifyCalls[0].code, '123456');
    assert.equal(verifyCalls[0].requestId, 'req-7');
    assert.equal(routerHits.length, 1);
    assert.equal(routerHits[0], '/dashboard');
  });
});

test('legacy email login remains accessible behind toggle link', async () => {
  const { render, fireEvent, waitFor } = await getTestingLib();
  const { LoginPageView } = await getLoginPageModule();
  const loginCalls: Array<{ email: string; password: string }> = [];
  const apiClient = {
    requestOtp: async () => ({ requestId: 'req-1' }),
    verifyOtp: async () => ({ user: { id: '1', email: 'a', fullName: 'b' }, accessToken: 'a', refreshToken: 'r' }),
    login: async (payload: { email: string; password: string }) => {
      loginCalls.push(payload);
      return { user: { id: '1', email: 'a', fullName: 'b' }, accessToken: 'a', refreshToken: 'r' };
    },
  };
  const routerHits: string[] = [];
  const routerStub = {
    push: async (href: string) => {
      routerHits.push(href);
      return true;
    },
  };

  const view = render(React.createElement(LoginPageView, { apiClient: apiClient as any, routerOverride: routerStub }));
  fireEvent.click(view.getByRole('button', { name: /use email login \(legacy\)/i }));
  fireEvent.input(view.getByLabelText(/email/i), { target: { value: 'legacy@example.com' } });
  fireEvent.input(view.getByLabelText(/password/i), { target: { value: 'secret123' } });
  fireEvent.click(view.getByRole('button', { name: /login with email/i }));

  await waitFor(() => {
    assert.equal(loginCalls.length, 1);
    assert.equal(loginCalls[0].email, 'legacy@example.com');
    assert.equal(loginCalls[0].password, 'secret123');
    assert.equal(routerHits[0], '/dashboard');
  });
});
