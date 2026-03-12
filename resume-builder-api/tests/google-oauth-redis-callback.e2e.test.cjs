const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { ConfigService } = require('@nestjs/config');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard.js');
const { GoogleAuthController } = require('../dist/auth/google-auth.controller.js');
const { GoogleDriveService, GOOGLE_DRIVE_CLIENT } = require('../dist/auth/google-drive.service.js');
const { DriveSessionService } = require('../dist/auth/drive-session.service.js');
const { ResumeService } = require('../dist/resume/resume.service.js');
const { GoogleTokenStore } = require('../dist/auth/tokenStore.js');
const { REDIS_CLIENT } = require('../dist/auth/redisClient.js');

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

function createMockRedis() {
  const values = new Map();
  return {
    async get(key) {
      return values.has(key) ? values.get(key) : null;
    },
    async set(key, value, _options = {}) {
      values.set(key, value);
      return 'OK';
    },
    async del(key) {
      return values.delete(key) ? 1 : 0;
    },
  };
}

async function createApp() {
  const redis = createMockRedis();
  const driveClient = {
    exchangeCodeForTokens: async () => ({
      accessToken: 'google-access-token',
      refreshToken: 'google-refresh-token',
      expiresIn: 3600,
      tokenType: 'Bearer',
      scope: 'openid email profile https://www.googleapis.com/auth/drive.readonly',
      idToken: 'google-id-token',
    }),
    refreshAccessToken: async () => ({
      accessToken: 'google-access-token-refreshed',
      refreshToken: 'google-refresh-token',
      expiresIn: 3600,
      tokenType: 'Bearer',
      scope: 'openid email profile https://www.googleapis.com/auth/drive.readonly',
    }),
    listResumeFiles: async () => ({ files: [] }),
    downloadFile: async () => ({ fileName: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') }),
  };

  const builder = Test.createTestingModule({
    controllers: [GoogleAuthController],
    providers: [
      DriveSessionService,
      GoogleDriveService,
      GoogleTokenStore,
      { provide: ResumeService, useValue: {} },
      { provide: GOOGLE_DRIVE_CLIENT, useValue: driveClient },
      { provide: REDIS_CLIENT, useValue: redis },
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
  return {
    app,
    tokenStore: moduleRef.get(GoogleTokenStore),
  };
}

test('Google OAuth callback persists encrypted tokens in redis-backed tokenStore', async () => {
  const { app, tokenStore } = await createApp();
  const server = app.getHttpServer();

  const startResponse = await request(server).get('/auth/google/start').expect(200);
  const startCookie = startResponse.headers['set-cookie'];
  const oauthUrl = new URL(startResponse.body.url);
  const state = oauthUrl.searchParams.get('state');

  await request(server)
    .get(`/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`)
    .set('Cookie', startCookie)
    .expect(302);

  const stored = await tokenStore.getGoogleTokens('user-1');
  assert.equal(stored?.accessToken, 'google-access-token');
  assert.equal(stored?.refreshToken, 'google-refresh-token');
  assert.equal(stored?.idToken, 'google-id-token');

  await app.close();
});

