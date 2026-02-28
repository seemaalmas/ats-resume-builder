const assert = require('node:assert/strict');
const test = require('node:test');
const { SettingsService } = require('../dist/settings/settings.service.js');

const APP_SETTING_ID = 'app-settings';

function createPrisma(initialRateLimitValue = true, initialPaymentEnabled = false) {
  const state = {
    appSetting: {
      id: APP_SETTING_ID,
      rateLimitEnabled: initialRateLimitValue,
      paymentFeatureEnabled: initialPaymentEnabled,
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    },
  };

  return {
    appSetting: {
      findUnique: async ({ where }) => {
        if (state.appSetting.id === where.id) {
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

test('SettingsService FORCE_DISABLE_RATE_LIMIT overrides DB value', async () => {
  await withEnv(
    {
      FORCE_DISABLE_RATE_LIMIT: 'true',
      RESUME_CREATION_RATE_LIMIT_DEFAULT: 'true',
      NODE_ENV: 'production',
    },
    async () => {
      const prisma = createPrisma(true);
      const service = new SettingsService(prisma);
      await service.onModuleInit();

      const state = await service.getResumeCreationRateLimitSetting();
      assert.equal(state.enabled, false);
      assert.equal(state.forcedDisabled, true);

      await service.setResumeCreationRateLimitEnabled(true);
      const stored = prisma.__getState().appSetting;
      assert.equal(stored.rateLimitEnabled, true);

      const nextState = await service.getResumeCreationRateLimitSetting();
      assert.equal(nextState.enabled, false);
      assert.equal(nextState.forcedDisabled, true);
    },
  );
});

test('ensureDefaults creates the singleton row when missing', async () => {
  const state = { appSetting: null };
  const prisma = {
    appSetting: {
      findUnique: async () => {
        return state.appSetting ? { ...state.appSetting } : null;
      },
      upsert: async ({ where, create }) => {
        state.appSetting = {
          id: where.id,
          rateLimitEnabled: create.rateLimitEnabled,
          paymentFeatureEnabled: create.paymentFeatureEnabled ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return { ...state.appSetting };
      },
    },
    __getState: () => state,
  };
  const service = new SettingsService(prisma);
  await service.ensureDefaults();

  const stored = await prisma.appSetting.findUnique({ where: { id: 'app-settings' } });
  assert.equal(stored.rateLimitEnabled, false);
  assert.equal(stored.paymentFeatureEnabled, false);
});

test('setPaymentFeatureEnabled toggles the feature flag', async () => {
  const prisma = createPrisma(true, false);
  const service = new SettingsService(prisma);
  await service.ensureDefaults();

  assert.equal(await service.isPaymentFeatureEnabled(), false);

  await service.setPaymentFeatureEnabled(true);
  assert.equal(await service.isPaymentFeatureEnabled(), true);
});
