const assert = require('node:assert/strict');
const test = require('node:test');
const bcrypt = require('bcryptjs');
const { VerifyOtpService } = require('../dist/auth/verify-otp.service.js');

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
  let challenge = overrides.challenge || null;
  const users = [...(overrides.users || [])];

  return {
    otpChallenge: {
      findFirst: async () => challenge,
      update: async ({ where, data }) => {
        calls.push({ type: 'otpUpdate', where, data });
        challenge = { ...challenge, ...data };
        return challenge;
      },
      deleteMany: async ({ where }) => {
        calls.push({ type: 'otpDelete', where });
        challenge = null;
      },
    },
    user: {
      findUnique: async ({ where }) => users.find((user) => user.mobile === where.mobile) || null,
      create: async ({ data, select }) => {
        const row = {
          id: data.id || `user-${users.length + 1}`,
          email: data.email,
          fullName: data.fullName,
          mobile: data.mobile,
          isAdmin: Boolean(data.isAdmin),
          plan: data.plan || 'FREE',
          ...data,
        };
        users.push(row);
        calls.push({ type: 'userCreate', data: row });
        if (!select) return row;
        const selected = {};
        for (const key of Object.keys(select)) selected[key] = row[key];
        return selected;
      },
      update: async ({ where, data, select }) => {
        const index = users.findIndex((user) => user.id === where.id);
        const existing = index >= 0 ? users[index] : { id: where.id };
        const merged = { ...existing, ...data };
        if (index >= 0) users[index] = merged;
        calls.push({ type: 'userUpdate', where, data });
        if (!select) return merged;
        const selected = {};
        for (const key of Object.keys(select)) selected[key] = merged[key];
        return selected;
      },
    },
    __calls: calls,
    __users: users,
  };
}

const authResponse = {
  user: { id: 'user-1', email: 'otp@test', fullName: 'Mobile User' },
  accessToken: 'a',
  refreshToken: 'r',
};

test('verify-otp with correct code returns auth payload and creates user if missing', async () => {
  const otp = '654321';
  const challenge = {
    id: 'otp-1',
    mobile: '+919307009420',
    otpHash: await bcrypt.hash(otp, 12),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    attempts: 0,
    lockedUntil: null,
  };
  const prisma = createPrismaStub({ challenge });
  const authService = {
    issueTokensForUser: () => Promise.resolve(authResponse),
    issueOtpSessionForUser: () => Promise.resolve(authResponse),
  };
  const service = new VerifyOtpService(prisma, authService, new StubConfig({ ADMIN_MOBILES: '+919307009427' }));

  const result = await service.verifyOtp('9307009420', otp);
  assert.equal(result, authResponse);
  assert(prisma.__calls.find((entry) => entry.type === 'otpDelete'));
  assert(prisma.__calls.find((entry) => entry.type === 'userCreate'));
});

test('verify-otp wrong attempts increment and lock after 5', async () => {
  const challenge = {
    id: 'otp-2',
    mobile: '+919307009421',
    otpHash: await bcrypt.hash('123456', 12),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    attempts: 4,
    lockedUntil: null,
  };
  const prisma = createPrismaStub({ challenge });
  const authService = {
    issueTokensForUser: () => Promise.resolve(authResponse),
    issueOtpSessionForUser: () => Promise.resolve(authResponse),
  };
  const service = new VerifyOtpService(prisma, authService, new StubConfig({ ADMIN_MOBILES: '+919307009427' }));

  await assert.rejects(() => service.verifyOtp('+919307009421', '000000'), { message: 'Invalid OTP' });
  const updateCall = prisma.__calls.find((entry) => entry.type === 'otpUpdate');
  assert.equal(updateCall.data.attempts, 5);
  assert(updateCall.data.lockedUntil instanceof Date);
});

test('verify-otp rejects expired OTP', async () => {
  const challenge = {
    id: 'otp-3',
    mobile: '+919307009422',
    otpHash: await bcrypt.hash('123456', 12),
    expiresAt: new Date(Date.now() - 60_000),
    createdAt: new Date(Date.now() - 120_000),
    attempts: 0,
    lockedUntil: null,
  };
  const prisma = createPrismaStub({ challenge });
  const authService = {
    issueTokensForUser: () => Promise.resolve(authResponse),
    issueOtpSessionForUser: () => Promise.resolve(authResponse),
  };
  const service = new VerifyOtpService(prisma, authService, new StubConfig({ ADMIN_MOBILES: '+919307009427' }));

  await assert.rejects(() => service.verifyOtp('+919307009422', '123456'), { message: 'OTP expired' });
});

test('verify-otp marks allowlisted admin mobile as isAdmin=true', async () => {
  const otp = '111222';
  const challenge = {
    id: 'otp-4',
    mobile: '+919307009427',
    otpHash: await bcrypt.hash(otp, 12),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    attempts: 0,
    lockedUntil: null,
  };
  const prisma = createPrismaStub({ challenge });
  const authService = {
    issueTokensForUser: () => Promise.resolve(authResponse),
    issueOtpSessionForUser: () => Promise.resolve(authResponse),
  };
  const service = new VerifyOtpService(prisma, authService, new StubConfig({ ADMIN_MOBILES: '+919307009427' }));

  await service.verifyOtp('919307009427', otp);
  const createdUser = prisma.__users.find((row) => row.mobile === '+919307009427');
  assert.equal(createdUser.isAdmin, true);
});
