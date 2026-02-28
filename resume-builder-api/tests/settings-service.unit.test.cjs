const assert = require('node:assert/strict');
const test = require('node:test');
const { SettingsService } = require('../dist/settings/settings.service.js');
const { PrismaClientKnownRequestError } = require('@prisma/client/runtime/library.js');
const { APP_SETTING_SINGLETON_ID } = require('../dist/settings/settings.constants.js');

function createService(options = {}) {
  const prisma = {
    appSetting: {
      upsert: options.upsert,
    },
  };
  return new SettingsService(prisma);
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

test('ensureDefaults calls upsert with default flag', async () => {
  await withEnv({ RESUME_CREATION_RATE_LIMIT_DEFAULT: 'true', NODE_ENV: 'production' }, async () => {
    let calledWith;
    const service = createService({
      upsert: async (args) => {
        calledWith = args;
        return {
          id: args.where.id,
          rateLimitEnabled: args.create.rateLimitEnabled,
          paymentFeatureEnabled: args.create.paymentFeatureEnabled,
          updatedAt: new Date(),
        };
      },
    });
    await service.ensureDefaults();

    assert.equal(calledWith.where.id, APP_SETTING_SINGLETON_ID);
    assert.equal(calledWith.update.rateLimitEnabled, true);
    assert.equal(calledWith.create.paymentFeatureEnabled, false);
  });
});

test('ensureDefaults surfaces helpful message when AppSetting table missing', async () => {
  const service = createService({
    upsert: async () => {
      throw new PrismaClientKnownRequestError('The table `AppSetting` does not exist', 'P2021', '1');
    },
  });

  await assert.rejects(
    () => service.ensureDefaults(),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /AppSetting table is missing/);
      return true;
    },
  );
});
