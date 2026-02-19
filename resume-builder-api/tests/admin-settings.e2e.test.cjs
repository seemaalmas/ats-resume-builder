const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { AdminController } = require('../dist/admin/admin.controller.js');
const { SettingsService } = require('../dist/settings/settings.service.js');
const { PrismaService } = require('../dist/prisma/prisma.service.js');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard.js');
const { AdminAuthGuard } = require('../dist/auth/admin-auth.guard.js');

const RATE_LIMIT_SETTING_KEY = 'RESUME_CREATION_RATE_LIMIT_ENABLED';

JwtAuthGuard.prototype.canActivate = function canActivate(context) {
  const req = context.switchToHttp().getRequest();
  req.user = {
    userId: String(req.headers['x-test-user-id'] || 'user-1'),
    email: String(req.headers['x-test-user-email'] || 'user-1@example.com'),
  };
  return true;
};

function createPrisma() {
  const state = {
    users: new Map([
      ['admin-1', { id: 'admin-1', email: 'admin@example.com' }],
      ['user-1', { id: 'user-1', email: 'user@example.com' }],
    ]),
    settings: new Map([
      [RATE_LIMIT_SETTING_KEY, {
        key: RATE_LIMIT_SETTING_KEY,
        value: 'false',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      }],
    ]),
  };

  return {
    user: {
      findUnique: async ({ where, select }) => {
        const key = where.id;
        const row = state.users.get(key);
        if (!row) return null;
        if (select && select.email) {
          return { email: row.email };
        }
        return { ...row };
      },
    },
    appSetting: {
      findUnique: async ({ where }) => {
        const row = state.settings.get(where.key);
        return row ? { ...row } : null;
      },
      upsert: async ({ where, create, update }) => {
        const existing = state.settings.get(where.key);
        if (existing) {
          const next = {
            ...existing,
            ...(update || {}),
            updatedAt: new Date(),
          };
          state.settings.set(where.key, next);
          return { ...next };
        }
        const created = {
          key: create.key,
          value: create.value,
          updatedAt: new Date(),
        };
        state.settings.set(create.key, created);
        return { ...created };
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
      ADMIN_EMAILS: 'admin@example.com',
      ADMIN_USER_IDS: undefined,
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
        .expect(403);

      const initial = await request(app.getHttpServer())
        .get('/admin/settings')
        .set('x-test-user-id', 'admin-1')
        .set('x-test-user-email', 'admin@example.com')
        .expect(200);

      assert.equal(initial.body.flags.resumeCreationRateLimitEnabled, false);

      const enabled = await request(app.getHttpServer())
        .put('/admin/settings/rate-limit')
        .set('x-test-user-id', 'admin-1')
        .set('x-test-user-email', 'admin@example.com')
        .send({ enabled: true })
        .expect(200);

      assert.equal(enabled.body.flags.resumeCreationRateLimitEnabled, true);

      const refreshed = await request(app.getHttpServer())
        .get('/admin/settings')
        .set('x-test-user-id', 'admin-1')
        .set('x-test-user-email', 'admin@example.com')
        .expect(200);

      assert.equal(refreshed.body.flags.resumeCreationRateLimitEnabled, true);
      assert.equal(prisma.__getState().settings.get(RATE_LIMIT_SETTING_KEY).value, 'true');

      const disabled = await request(app.getHttpServer())
        .put('/admin/settings/rate-limit')
        .set('x-test-user-id', 'admin-1')
        .set('x-test-user-email', 'admin@example.com')
        .send({ enabled: false })
        .expect(200);

      assert.equal(disabled.body.flags.resumeCreationRateLimitEnabled, false);
      assert.equal(prisma.__getState().settings.get(RATE_LIMIT_SETTING_KEY).value, 'false');

      await app.close();
    },
  );
});
