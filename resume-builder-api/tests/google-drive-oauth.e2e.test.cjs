const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { ConfigService } = require('@nestjs/config');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard.js');
const { GoogleAuthController } = require('../dist/auth/google-auth.controller.js');
const { GoogleDriveController } = require('../dist/auth/google-drive.controller.js');
const { GoogleDriveService, GOOGLE_DRIVE_CLIENT } = require('../dist/auth/google-drive.service.js');
const { DriveSessionService } = require('../dist/auth/drive-session.service.js');
const { GoogleTokenStore } = require('../dist/auth/tokenStore.js');
const { REDIS_CLIENT } = require('../dist/auth/redisClient.js');
const { ResumeService } = require('../dist/resume/resume.service.js');

class StubConfigService {
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

const AuthGuardAllow = {
  canActivate(ctx) {
    const req = ctx.switchToHttp().getRequest();
    req.user = { userId: 'user-1', email: 'user@example.com' };
    return true;
  },
};

async function createApp(overrides = {}) {
  const parseCalls = [];
  const resumeService = {
    parseResumeUpload: async (file) => {
      parseCalls.push(file);
      return {
        title: 'Imported from Drive',
        contact: { fullName: 'Drive User', email: 'drive@example.com' },
        summary: 'Imported summary',
        skills: ['TypeScript', 'React'],
        experience: [],
        education: [],
        projects: [],
        certifications: [],
      };
    },
  };

  const driveClient = {
    exchangeCodeForTokens: async () => ({
      accessToken: 'google-access-token',
      refreshToken: 'google-refresh-token',
      expiresIn: 3600,
      tokenType: 'Bearer',
      scope: 'openid email profile https://www.googleapis.com/auth/drive.readonly',
    }),
    listResumeFiles: async () => ({
      files: [{ id: 'file-1', name: 'resume.pdf', mimeType: 'application/pdf' }],
    }),
    downloadFile: async () => ({
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    }),
    ...overrides.driveClient,
  };

  const redisValues = new Map();
  const redisClient = {
    async get(key) {
      return redisValues.has(key) ? redisValues.get(key) : null;
    },
    async set(key, value) {
      redisValues.set(key, value);
      return 'OK';
    },
    async del(key) {
      return redisValues.delete(key) ? 1 : 0;
    },
  };

  const builder = Test.createTestingModule({
    controllers: [GoogleAuthController, GoogleDriveController],
    providers: [
      DriveSessionService,
      GoogleDriveService,
      GoogleTokenStore,
      { provide: ResumeService, useValue: resumeService },
      { provide: GOOGLE_DRIVE_CLIENT, useValue: driveClient },
      { provide: REDIS_CLIENT, useValue: redisClient },
      {
        provide: ConfigService,
        useValue: new StubConfigService({
          NODE_ENV: 'test',
          CORS_ORIGIN: 'http://localhost:3000',
          GOOGLE_CLIENT_ID: 'google-client-id',
          GOOGLE_CLIENT_SECRET: 'google-client-secret',
          GOOGLE_REDIRECT_URI: 'http://localhost:5000/auth/google/callback',
          GOOGLE_OAUTH_SUCCESS_REDIRECT: 'http://localhost:3000/dashboard',
          TOKEN_ENC_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
        }),
      },
    ],
  });

  builder.overrideGuard(JwtAuthGuard).useValue(AuthGuardAllow);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, parseCalls };
}

test('Google OAuth callback sets secure session cookie and marks session connected', async () => {
  const { app } = await createApp();
  const server = app.getHttpServer();

  const startResponse = await request(server)
    .get('/auth/google/start')
    .expect(200);
  assert.equal(typeof startResponse.body.url, 'string');
  const startCookie = startResponse.headers['set-cookie'];
  assert.ok(Array.isArray(startCookie) && startCookie.some((value) => value.includes('rb_drive_session=')));

  const oauthUrl = new URL(startResponse.body.url);
  const state = oauthUrl.searchParams.get('state');
  assert.equal(typeof state, 'string');
  assert.ok(state && state.length > 10);

  const callbackResponse = await request(server)
    .get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
    .set('Cookie', startCookie)
    .expect(302);

  const callbackCookies = callbackResponse.headers['set-cookie'];
  assert.ok(Array.isArray(callbackCookies) && callbackCookies.some((value) => value.includes('rb_drive_session=')));
  assert.equal(callbackResponse.headers.location, 'http://localhost:3000/dashboard?drive=connected');

  await app.close();
});

test('Drive import returns parsed payload and does not persist resume content', async () => {
  const { app, parseCalls } = await createApp();
  const server = app.getHttpServer();

  const startResponse = await request(server)
    .get('/auth/google/start')
    .expect(200);
  const startCookie = startResponse.headers['set-cookie'];
  const oauthUrl = new URL(startResponse.body.url);
  const state = oauthUrl.searchParams.get('state');

  await request(server)
    .get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
    .set('Cookie', startCookie)
    .expect(302);

  const importResponse = await request(server)
    .post('/drive/import')
    .set('Cookie', startCookie)
    .send({ fileId: 'file-1' })
    .expect(200);

  assert.equal(importResponse.body.resume.title, 'Imported from Drive');
  assert.equal(importResponse.body.resume.contact.fullName, 'Drive User');
  assert.equal(parseCalls.length, 1, 'resume parser should be called exactly once');
  assert.equal(importResponse.body.persisted, false);

  await app.close();
});
