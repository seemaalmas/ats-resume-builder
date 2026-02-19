const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { HealthController } = require('../dist/health/health.controller.js');
const { PrismaService } = require('../dist/prisma/prisma.service.js');

async function createApp(prisma) {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

test('GET /health/db returns 200 when db ping succeeds', async () => {
  const prisma = {
    ping: async () => ({ ok: true }),
    getConnectionInfo: () => ({ host: 'localhost', port: 5432 }),
  };

  const app = await createApp(prisma);

  const response = await request(app.getHttpServer())
    .get('/health/db')
    .expect(200);

  assert.equal(response.body.ok, true);
  assert.equal(response.body.status, 'ready');
  assert.equal(response.body.db, 'up');
  assert.equal(response.body.host, 'localhost');
  assert.equal(response.body.port, 5432);

  await app.close();
});
