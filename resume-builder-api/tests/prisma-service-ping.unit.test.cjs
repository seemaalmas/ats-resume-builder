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

test('PrismaService init connects and pings when DATABASE_URL is valid', async () => {
  await withEnv(
    {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/resume_builder?schema=public',
    },
    async () => {
      const service = new PrismaService();
      let connectCalls = 0;
      let queryCalls = 0;
      service.$connect = async () => {
        connectCalls += 1;
      };
      service.$queryRawUnsafe = async (query) => {
        queryCalls += 1;
        assert.equal(query, 'SELECT 1');
        return [{ '?column?': 1 }];
      };

      await service.onModuleInit();

      assert.equal(connectCalls, 1);
      assert.equal(queryCalls, 1);
      const info = service.getConnectionInfo();
      assert.equal(info.host, 'localhost');
      assert.equal(info.port, 5432);
      assert.equal(info.database, 'resume_builder');
    },
  );
});
