const assert = require('node:assert/strict');
const test = require('node:test');
const { RequestOtpService } = require('../dist/auth/request-otp.service.js');

class StubConfig {
  constructor(values) {
    this.values = values || {};
  }
  get(key, fallback) {
    if (key in this.values) return this.values[key];
    return fallback;
  }
}

function createPrismaStub(overrides = {}) {
  const calls = [];
  let latestChallenge = overrides.latestChallenge || null;
  return {
    otpChallenge: {
      findFirst: async () => latestChallenge,
      deleteMany: async ({ where }) => {
        calls.push({ type: 'delete', where });
      },
      create: async ({ data }) => {
        calls.push({ type: 'create', data });
        latestChallenge = { ...data, id: 'otp-1', attempts: 0, lockedUntil: null, createdAt: new Date() };
        return latestChallenge;
      },
    },
    __calls: calls,
  };
}

test('request-otp creates challenge and returns devOtp in non-production', async () => {
  const prisma = createPrismaStub();
  const sender = { send: () => Promise.reject(new Error('should not run')) };
  const service = new RequestOtpService(prisma, sender, new StubConfig({ NODE_ENV: 'development' }));

  const response = await service.requestOtp('9307009427', { ip: '10.10.10.1' });
  assert.equal(response.ok, true);
  assert.match(String(response.devOtp || ''), /^\d{6}$/);
  const createCall = prisma.__calls.find((entry) => entry.type === 'create');
  assert(createCall, 'challenge should be created');
  assert.equal(createCall.data.mobile, '+919307009427');
  assert.equal(createCall.data.ip, '10.10.10.1');
  assert.ok(createCall.data.otpHash);
});

test('request-otp rejects when last challenge was created within 60 seconds', async () => {
  const prisma = createPrismaStub({
    latestChallenge: {
      id: 'otp-2',
      mobile: '+919307009427',
      otpHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(Date.now() - 30_000),
      attempts: 0,
      lockedUntil: null,
    },
  });
  const sender = { send: () => Promise.resolve() };
  const service = new RequestOtpService(prisma, sender, new StubConfig({ NODE_ENV: 'development' }));

  await assert.rejects(() => service.requestOtp('+919307009427'), {
    message: 'OTP already sent. Please wait 60 seconds.',
  });
});

test('request-otp rejects when challenge is locked', async () => {
  const prisma = createPrismaStub({
    latestChallenge: {
      id: 'otp-3',
      mobile: '+919307009427',
      otpHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(Date.now() - 120_000),
      attempts: 5,
      lockedUntil: new Date(Date.now() + 5 * 60_000),
    },
  });
  const sender = { send: () => Promise.resolve() };
  const service = new RequestOtpService(prisma, sender, new StubConfig({ NODE_ENV: 'development' }));

  await assert.rejects(() => service.requestOtp('+919307009427'), {
    message: 'Too many attempts. Try again later.',
  });
});

test('request-otp in production calls SMS sender and omits devOtp', async () => {
  const prisma = createPrismaStub();
  const calls = [];
  const sender = {
    send: (mobile, message) => {
      calls.push({ mobile, message });
      return Promise.resolve();
    },
  };
  const service = new RequestOtpService(prisma, sender, new StubConfig({ NODE_ENV: 'production' }));

  const response = await service.requestOtp('919307009427');
  assert.equal(response.ok, true);
  assert.equal(response.devOtp, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mobile, '+919307009427');
  assert.match(calls[0].message, /\d{6}/);
});
