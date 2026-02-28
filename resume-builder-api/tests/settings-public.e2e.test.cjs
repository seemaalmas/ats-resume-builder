const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { SettingsController } = require('../dist/settings/settings.controller.js');
const { SettingsService } = require('../dist/settings/settings.service.js');
const { PrismaService } = require('../dist/prisma/prisma.service.js');

function createPrisma(paymentFeatureEnabled = false) {
  const state = {
    appSetting: {
      id: 'app-settings',
      rateLimitEnabled: true,
      paymentFeatureEnabled,
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    },
  };

  return {
    appSetting: {
      findUnique: async ({ where }) => {
        if (where.id === state.appSetting.id) {
          return { ...state.appSetting };
        }
        return null;
      },
      upsert: async ({ where, create, update }) => {
        if (state.appSetting && state.appSetting.id === where.id) {
          state.appSetting = {
            ...state.appSetting,
            ...(update || {}),
            updatedAt: new Date(),
          };
          return { ...state.appSetting };
        }
        state.appSetting = {
          id: create.id,
          rateLimitEnabled: create.rateLimitEnabled ?? false,
          paymentFeatureEnabled: create.paymentFeatureEnabled ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return { ...state.appSetting };
      },
    },
  };
}

async function createApp(prisma) {
  const moduleRef = await Test.createTestingModule({
    controllers: [SettingsController],
    providers: [
      SettingsService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

test('/settings/public returns current paymentFeatureEnabled flag', async () => {
  const prisma = createPrisma(true);
  const app = await createApp(prisma);

  const response = await request(app.getHttpServer())
    .get('/settings/public')
    .expect(200);

  assert.equal(response.body.paymentFeatureEnabled, true);

  await app.close();
});

test('/settings/public defaults to false when no flag row exists', async () => {
  const prisma = createPrisma(false);
  prisma.appSetting.findUnique = async () => null;
  const app = await createApp(prisma);

  const response = await request(app.getHttpServer())
    .get('/settings/public')
    .expect(200);

  assert.equal(response.body.paymentFeatureEnabled, false);

  await app.close();
});
