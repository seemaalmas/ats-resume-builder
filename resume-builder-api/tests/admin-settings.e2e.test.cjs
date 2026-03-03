const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { AdminController } = require('../dist/admin/admin.controller.js');
const { SettingsService } = require('../dist/settings/settings.service.js');
const { PrismaService } = require('../dist/prisma/prisma.service.js');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard.js');
const { AdminAuthGuard } = require('../dist/auth/admin-auth.guard.js');

const APP_SETTING_ID = 'app-settings';

JwtAuthGuard.prototype.canActivate = function canActivate(context) {
  const req = context.switchToHttp().getRequest();
  req.user = {
    userId: String(req.headers['x-test-user-id'] || 'user-1'),
    email: String(req.headers['x-test-user-email'] || 'user-1@example.com'),
    mobile: String(req.headers['x-test-user-mobile'] || ''),
  };
  return true;
};

function createPrisma() {
  const state = {
    users: new Map([
      ['admin-1', { id: 'admin-1', email: 'admin@example.com', mobile: '+919307009427' }],
      ['user-1', { id: 'user-1', email: 'user@example.com', mobile: '+919400000000' }],
    ]),
    appSetting: {
      id: APP_SETTING_ID,
      rateLimitEnabled: false,
      paymentFeatureEnabled: false,
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    },
  };

  return {
    user: {
        findUnique: async ({ where, select }) => {
          const key = where.id;
          const row = state.users.get(key);
          if (!row) return null;
          if (select) {
            const result = {};
            if (select.email) result.email = row.email;
            if (select.mobile) result.mobile = row.mobile;
            return result;
          }
          return { ...row };
        },
    },
    appSetting: {
      findUnique: async ({ where }) => {
        if (where.id === state.appSetting.id) {
          return { ...state.appSetting };
        }
        return null;
      },
      upsert: async ({ where, create, update }) => {
        if (state.appSetting.id !== where.id) {
          state.appSetting = {
            id: create.id,
            rateLimitEnabled: create.rateLimitEnabled,
            paymentFeatureEnabled: create.paymentFeatureEnabled ?? false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          return { ...state.appSetting };
        }
        state.appSetting = {
          ...state.appSetting,
          ...(update || {}),
          updatedAt: new Date(),
        };
        return { ...state.appSetting };
      },
    },
    __getState: () => state,
  };
}

async function createApp(prisma) {
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminController],
    providers: [
      SettingsService,
      AdminAuthGuard,
      { provide: PrismaService, useValue: prisma },
      JwtAuthGuard,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

async function withEnv(overrides, run) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('admin settings endpoints block non-admin and allow admin toggle persistence', async () => {
    await withEnv(
      {
        ADMIN_EMAILS: undefined,
        ADMIN_USER_IDS: undefined,
        ADMIN_MOBILES: '+919307009427',
        FORCE_DISABLE_RATE_LIMIT: undefined,
        RESUME_CREATION_RATE_LIMIT_DEFAULT: 'false',
        NODE_ENV: 'production',
      },
      async () => {
      const prisma = createPrisma();
      const app = await createApp(prisma);

      await request(app.getHttpServer())
      .get('/admin/settings')
      .set('x-test-user-id', 'user-1')
      .set('x-test-user-email', 'user@example.com')
      .set('x-test-user-mobile', '+919400000000')
        .expect(403);

      const initial = await request(app.getHttpServer())
      .get('/admin/settings')
      .set('x-test-user-id', 'admin-1')
      .set('x-test-user-email', 'admin@example.com')
      .set('x-test-user-mobile', '+919307009427')
        .expect(200);

      assert.equal(initial.body.flags.resumeCreationRateLimitEnabled, false);
      assert.equal(initial.body.flags.paymentFeatureEnabled, false);

      const enabled = await request(app.getHttpServer())
      .put('/admin/settings/rate-limit')
      .set('x-test-user-id', 'admin-1')
      .set('x-test-user-email', 'admin@example.com')
      .set('x-test-user-mobile', '+919307009427')
        .send({ enabled: true })
        .expect(200);

      assert.equal(enabled.body.flags.resumeCreationRateLimitEnabled, true);

      const refreshed = await request(app.getHttpServer())
      .get('/admin/settings')
      .set('x-test-user-id', 'admin-1')
      .set('x-test-user-email', 'admin@example.com')
      .set('x-test-user-mobile', '+919307009427')
        .expect(200);

      assert.equal(refreshed.body.flags.resumeCreationRateLimitEnabled, true);
      assert.equal(refreshed.body.flags.paymentFeatureEnabled, false);
      assert.equal(prisma.__getState().appSetting.rateLimitEnabled, true);

      const disabled = await request(app.getHttpServer())
      .put('/admin/settings/rate-limit')
      .set('x-test-user-id', 'admin-1')
      .set('x-test-user-email', 'admin@example.com')
      .set('x-test-user-mobile', '+919307009427')
        .send({ enabled: false })
        .expect(200);

      assert.equal(disabled.body.flags.resumeCreationRateLimitEnabled, false);
      assert.equal(disabled.body.flags.paymentFeatureEnabled, false);
      assert.equal(prisma.__getState().appSetting.rateLimitEnabled, false);

      const paymentEnabled = await request(app.getHttpServer())
      .put('/admin/settings/payment')
      .set('x-test-user-id', 'admin-1')
      .set('x-test-user-email', 'admin@example.com')
      .set('x-test-user-mobile', '+919307009427')
        .send({ enabled: true })
        .expect(200);

      assert.equal(paymentEnabled.body.flags.paymentFeatureEnabled, true);
      assert.equal(prisma.__getState().appSetting.paymentFeatureEnabled, true);

      const paymentDisabled = await request(app.getHttpServer())
      .put('/admin/settings/payment')
      .set('x-test-user-id', 'admin-1')
      .set('x-test-user-email', 'admin@example.com')
      .set('x-test-user-mobile', '+919307009427')
        .send({ enabled: false })
        .expect(200);

      assert.equal(paymentDisabled.body.flags.paymentFeatureEnabled, false);
      assert.equal(prisma.__getState().appSetting.paymentFeatureEnabled, false);

      await app.close();
    },
  );
});


test('PATCH /admin/settings toggles payment flag and denies non-admin', async () => {
  await withEnv(
    {
      ADMIN_EMAILS: 'admin@example.com',
      ADMIN_USER_IDS: undefined,
      ADMIN_MOBILES: '+919307009427',
      FORCE_DISABLE_RATE_LIMIT: undefined,
      RESUME_CREATION_RATE_LIMIT_DEFAULT: 'false',
      NODE_ENV: 'production',
    },
    async () => {
      const prisma = createPrisma();
      const app = await createApp(prisma);

      await request(app.getHttpServer())
      .patch('/admin/settings')
      .set('x-test-user-id', 'user-1')
      .set('x-test-user-email', 'user@example.com')
      .set('x-test-user-mobile', '+919400000000')
        .send({ paymentFeatureEnabled: true })
        .expect(403);

      const response = await request(app.getHttpServer())
      .patch('/admin/settings')
      .set('x-test-user-id', 'admin-1')
      .set('x-test-user-email', 'admin@example.com')
      .set('x-test-user-mobile', '+919307009427')
        .send({ paymentFeatureEnabled: true })
        .expect(200);

      assert.equal(response.body.flags.paymentFeatureEnabled, true);
      assert.equal(prisma.__getState().appSetting.paymentFeatureEnabled, true);

      await app.close();
    },
  );
});
