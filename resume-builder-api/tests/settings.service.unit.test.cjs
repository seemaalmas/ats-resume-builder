const assert = require('node:assert/strict');
const test = require('node:test');
const { SettingsService } = require('../dist/settings/settings.service.js');

const RATE_LIMIT_SETTING_KEY = 'RESUME_CREATION_RATE_LIMIT_ENABLED';

function createPrisma(initialValue = 'true') {
  const state = {
    settings: new Map([
      [RATE_LIMIT_SETTING_KEY, {
        key: RATE_LIMIT_SETTING_KEY,
        value: initialValue,
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      }],
    ]),
  };

  return {
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
      const prisma = createPrisma('true');
      const service = new SettingsService(prisma);
      await service.onModuleInit();

      const state = await service.getResumeCreationRateLimitSetting();
      assert.equal(state.enabled, false);
      assert.equal(state.forcedDisabled, true);

      await service.setResumeCreationRateLimitEnabled(true);
      const stored = prisma.__getState().settings.get(RATE_LIMIT_SETTING_KEY);
      assert.equal(stored.value, 'true');

      const nextState = await service.getResumeCreationRateLimitSetting();
      assert.equal(nextState.enabled, false);
      assert.equal(nextState.forcedDisabled, true);
    },
  );
});
