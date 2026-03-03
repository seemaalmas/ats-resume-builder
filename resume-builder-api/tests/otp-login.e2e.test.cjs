const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { ConfigService } = require('@nestjs/config');
const { OtpController } = require('../dist/auth/otp.controller.js');
const { OtpAuthService } = require('../dist/auth/otp-auth.service.js');
const { RequestOtpService } = require('../dist/auth/request-otp.service.js');
const { VerifyOtpService } = require('../dist/auth/verify-otp.service.js');
const { AuthService } = require('../dist/auth/auth.service.js');
const { PrismaService } = require('../dist/prisma/prisma.service.js');
const { SMS_PROVIDER } = require('../dist/auth/sms.provider.js');

class StubConfig {
  constructor(values = {}) {
    this.values = values;
  }

  get(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(this.values, key)) {
      return this.values[key];
    }
    return fallback;
  }
}

function createPrisma() {
  const usersByMobile = new Map();
  const usersById = new Map();
  let userSeq = 1;

  return {
    user: {
      findUnique: async ({ where, select }) => {
        let user = null;
        if (where?.mobile) {
          user = usersByMobile.get(where.mobile) || null;
        } else if (where?.id) {
          user = usersById.get(where.id) || null;
        } else if (where?.email) {
          user = Array.from(usersById.values()).find((row) => row.email === where.email) || null;
        }
        if (!user) return null;
        if (!select) return { ...user };
        const selected = {};
        for (const key of Object.keys(select)) selected[key] = user[key];
        return selected;
      },
      create: async ({ data, select }) => {
        const id = data.id || `user-${userSeq++}`;
        const row = { id, ...data };
        usersByMobile.set(row.mobile, row);
        usersById.set(row.id, row);
        if (!select) return { ...row };
        const selected = {};
        for (const key of Object.keys(select)) selected[key] = row[key];
        return selected;
      },
      update: async ({ where, data, select }) => {
        const existing = usersById.get(where.id);
        if (!existing) throw new Error('user not found');
        const next = { ...existing, ...data };
        usersById.set(where.id, next);
        if (next.mobile) usersByMobile.set(next.mobile, next);
        if (!select) return { ...next };
        const selected = {};
        for (const key of Object.keys(select)) selected[key] = next[key];
        return selected;
      },
    },
    __state: {
      usersById,
      usersByMobile,
    },
  };
}

function createSmsProviderMock() {
  const calls = {
    send: [],
    verify: [],
  };
  const requestCodes = new Map();
  let seq = 1;

  return {
    calls,
    provider: {
      sendOtp: async (phoneE164) => {
        const requestId = `req-${seq++}`;
        requestCodes.set(requestId, { phoneE164, code: '123456' });
        calls.send.push({ phoneE164, requestId });
        return { requestId };
      },
      verifyOtp: async (phoneE164, code, requestId) => {
        calls.verify.push({ phoneE164, code, requestId });
        const match = requestCodes.get(requestId);
        return { success: Boolean(match && match.phoneE164 === phoneE164 && match.code === code) };
      },
    },
  };
}

async function createApp({ prisma, smsProvider }) {
  const issueSession = async (user) => ({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    },
    accessToken: `access-${user.id}`,
    refreshToken: `refresh-${user.id}`,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });

  const authService = {
    issueTokensForUser: async (user) => ({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
      accessToken: `access-${user.id}`,
      refreshToken: `refresh-${user.id}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
    issueOtpSessionForUser: issueSession,
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [OtpController],
    providers: [
      OtpAuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: SMS_PROVIDER, useValue: smsProvider },
      { provide: AuthService, useValue: authService },
      {
        provide: ConfigService,
        useValue: new StubConfig({
          ADMIN_MOBILES: '+919307009427',
          OTP_SEND_LIMIT_PER_PHONE_PER_HOUR: '5',
          OTP_VERIFY_LIMIT_PER_PHONE_PER_HOUR: '20',
        }),
      },
      { provide: RequestOtpService, useValue: { requestOtp: async () => ({ ok: true }) } },
      { provide: VerifyOtpService, useValue: { verifyOtp: async () => ({ ok: true }) } },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

test('POST /auth/otp/send returns requestId', async () => {
  const prisma = createPrisma();
  const sms = createSmsProviderMock();
  const app = await createApp({ prisma, smsProvider: sms.provider });

  const response = await request(app.getHttpServer())
    .post('/auth/otp/send')
    .send({ phone: '9307009427' })
    .expect(200);

  assert.equal(typeof response.body.requestId, 'string');
  assert.match(response.body.requestId, /^req-\d+$/);
  assert.equal(sms.calls.send.length, 1);
  assert.equal(sms.calls.send[0].phoneE164, '+919307009427');

  await app.close();
});

test('POST /auth/otp/verify with correct code returns token session payload', async () => {
  const prisma = createPrisma();
  const sms = createSmsProviderMock();
  const app = await createApp({ prisma, smsProvider: sms.provider });
  const server = app.getHttpServer();

  const sendResponse = await request(server)
    .post('/auth/otp/send')
    .send({ phone: '+919307009425' })
    .expect(200);

  const verifyResponse = await request(server)
    .post('/auth/otp/verify')
    .send({ phone: '+919307009425', code: '123456', requestId: sendResponse.body.requestId })
    .expect(200);

  assert.equal(typeof verifyResponse.body.accessToken, 'string');
  assert.equal(typeof verifyResponse.body.refreshToken, 'string');
  assert.equal(typeof verifyResponse.body.expiresAt, 'string');
  assert.equal(verifyResponse.body.user.email, 'otp919307009425@mobile.resume');
  assert.equal(sms.calls.verify.length, 1);
  assert.equal(prisma.__state.usersByMobile.get('+919307009425')?.mobile, '+919307009425');

  await app.close();
});

test('POST /auth/otp/verify with wrong code returns 401', async () => {
  const prisma = createPrisma();
  const sms = createSmsProviderMock();
  const app = await createApp({ prisma, smsProvider: sms.provider });
  const server = app.getHttpServer();

  const sendResponse = await request(server)
    .post('/auth/otp/send')
    .send({ phone: '+919307009426' })
    .expect(200);

  await request(server)
    .post('/auth/otp/verify')
    .send({ phone: '+919307009426', code: '000000', requestId: sendResponse.body.requestId })
    .expect(401);

  await app.close();
});

test('POST /auth/otp/verify without requestId returns 400', async () => {
  const prisma = createPrisma();
  const sms = createSmsProviderMock();
  const app = await createApp({ prisma, smsProvider: sms.provider });
  const server = app.getHttpServer();

  await request(server)
    .post('/auth/otp/verify')
    .send({ phone: '+919307009426', code: '123456' })
    .expect(400);

  await app.close();
});

test('POST /auth/otp/send enforces per-phone hourly rate limit (429)', async () => {
  const prisma = createPrisma();
  const sms = createSmsProviderMock();

  const moduleRef = await Test.createTestingModule({
    controllers: [OtpController],
    providers: [
      OtpAuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: SMS_PROVIDER, useValue: sms.provider },
      {
        provide: AuthService,
        useValue: {
          issueTokensForUser: async (user) => ({
            user,
            accessToken: 'a',
            refreshToken: 'r',
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          }),
          issueOtpSessionForUser: async (user) => ({
            user,
            accessToken: 'a',
            refreshToken: 'r',
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          }),
        },
      },
      {
        provide: ConfigService,
        useValue: new StubConfig({
          ADMIN_MOBILES: '+919307009427',
          OTP_SEND_LIMIT_PER_PHONE_PER_HOUR: '1',
          OTP_VERIFY_LIMIT_PER_PHONE_PER_HOUR: '20',
        }),
      },
      { provide: RequestOtpService, useValue: { requestOtp: async () => ({ ok: true }) } },
      { provide: VerifyOtpService, useValue: { verifyOtp: async () => ({ ok: true }) } },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  const server = app.getHttpServer();

  await request(server)
    .post('/auth/otp/send')
    .send({ phone: '+919307009500' })
    .expect(200);

  await request(server)
    .post('/auth/otp/send')
    .send({ phone: '+919307009500' })
    .expect(429);

  await app.close();
});

test('POST /auth/otp/verify enforces per-phone hourly verify rate limit (429)', async () => {
  const prisma = createPrisma();
  const sms = createSmsProviderMock();

  const moduleRef = await Test.createTestingModule({
    controllers: [OtpController],
    providers: [
      OtpAuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: SMS_PROVIDER, useValue: sms.provider },
      {
        provide: AuthService,
        useValue: {
          issueTokensForUser: async (user) => ({
            user,
            accessToken: 'a',
            refreshToken: 'r',
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          }),
          issueOtpSessionForUser: async (user) => ({
            user,
            accessToken: 'a',
            refreshToken: 'r',
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          }),
        },
      },
      {
        provide: ConfigService,
        useValue: new StubConfig({
          ADMIN_MOBILES: '+919307009427',
          OTP_SEND_LIMIT_PER_PHONE_PER_HOUR: '5',
          OTP_VERIFY_LIMIT_PER_PHONE_PER_HOUR: '1',
        }),
      },
      { provide: RequestOtpService, useValue: { requestOtp: async () => ({ ok: true }) } },
      { provide: VerifyOtpService, useValue: { verifyOtp: async () => ({ ok: true }) } },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  const server = app.getHttpServer();

  const sendResponse = await request(server)
    .post('/auth/otp/send')
    .send({ phone: '+919307009501' })
    .expect(200);

  await request(server)
    .post('/auth/otp/verify')
    .send({ phone: '+919307009501', code: '000000', requestId: sendResponse.body.requestId })
    .expect(401);

  await request(server)
    .post('/auth/otp/verify')
    .send({ phone: '+919307009501', code: '123456', requestId: sendResponse.body.requestId })
    .expect(429);

  await app.close();
});
