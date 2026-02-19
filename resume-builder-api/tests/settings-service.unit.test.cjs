const assert = require('node:assert/strict');
const test = require('node:test');
const { SettingsService } = require('../dist/settings/settings.service.js');
const { PrismaClientKnownRequestError } = require('@prisma/client/runtime/library.js');

function createService(overrides = {}) {
  const prisma = {
    appSetting: {
      upsert: overrides.upsert,
    },
  };
  return new SettingsService(prisma);
}

test('ensureDefaults calls upsert with default flag', async () => {
  let called = 0;
  const service = createService({
    upsert: async (args) => {
      called += 1;
      assert.equal(args.where.key, 'RESUME_CREATION_RATE_LIMIT_ENABLED');
      return { key: args.create.key, value: args.create.value, updatedAt: new Date() };
    },
  });

  await service.ensureDefaults();
  assert.equal(called, 1);
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
      assert.ok(
        error instanceof Error,
        'Expected an Error to be thrown when AppSetting table is missing',
      );
      assert.match(error.message, /AppSetting table is missing/);
      return true;
    },
  );
});
