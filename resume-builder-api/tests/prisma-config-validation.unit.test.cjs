const assert = require('node:assert/strict');
const test = require('node:test');
const { PrismaService } = require('../dist/prisma/prisma.service.js');

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

test('app init fails with clear message when DATABASE_URL uses prisma://', async () => {
  await withEnv(
    {
      DATABASE_URL: 'prisma://example.invalid/my-db?api_key=abc',
    },
    async () => {
      const service = new PrismaService();
      let connectCalls = 0;
      service.$connect = async () => {
        connectCalls += 1;
      };

      await assert.rejects(
        () => service.onModuleInit(),
        /DATABASE_URL must be postgresql:\/\/\.\.\. Do not use prisma:\/\//i,
      );
      assert.equal(connectCalls, 0);
    },
  );
});
