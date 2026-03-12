const test = require('node:test');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { AuthController } = require('../dist/auth/auth.controller.js');
const { AuthService } = require('../dist/auth/auth.service.js');

async function createApp() {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      {
        provide: AuthService,
        useValue: {
          register: async (payload) => payload,
          login: async () => ({}),
          refresh: async () => ({}),
          logout: async () => ({ ok: true }),
        },
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

test('POST /auth/register requires email', async () => {
  const app = await createApp();
  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ fullName: 'User Without Email', password: 'secret123' })
    .expect(400);
  await app.close();
});
