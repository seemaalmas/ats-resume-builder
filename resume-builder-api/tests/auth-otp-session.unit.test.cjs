const assert = require('node:assert/strict');
const test = require('node:test');
const { JwtService } = require('@nestjs/jwt');
const { AuthService } = require('../dist/auth/auth.service.js');

class StubConfig {
  constructor(values = {}) {
    this.values = values;
  }

  get(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(this.values, key)) {
      return this.values[key];
    }
    return fallback;
  }
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  assert.ok(parts.length >= 2, 'invalid jwt');
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

test('AuthService.issueOtpSessionForUser issues 30 minute access/refresh tokens and expiresAt', async () => {
  const updates = [];
  const prisma = {
    user: {
      update: async (args) => {
        updates.push(args);
        return { id: args.where.id };
      },
    },
  };

  const config = new StubConfig({
    JWT_SECRET: 'test-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    JWT_EXPIRES_IN: '7d',
    JWT_REFRESH_EXPIRES_IN: '30d',
  });
  const service = new AuthService(prisma, new JwtService(), config);
  const result = await service.issueOtpSessionForUser({
    id: 'user-otp-1',
    email: 'otp@example.com',
    fullName: 'Otp User',
    mobile: '+919999999999',
  });

  assert.equal(typeof result.accessToken, 'string');
  assert.equal(typeof result.refreshToken, 'string');
  assert.equal(typeof result.expiresAt, 'string');

  const accessPayload = decodeJwtPayload(result.accessToken);
  const refreshPayload = decodeJwtPayload(result.refreshToken);

  assert.equal(accessPayload.typ, 'access');
  assert.equal(refreshPayload.typ, 'refresh');
  assert.equal(accessPayload.sub, 'user-otp-1');
  assert.equal(refreshPayload.sub, 'user-otp-1');

  const accessTtlSeconds = Number(accessPayload.exp) - Number(accessPayload.iat);
  const refreshTtlSeconds = Number(refreshPayload.exp) - Number(refreshPayload.iat);
  assert.ok(accessTtlSeconds >= 1790 && accessTtlSeconds <= 1810, `access TTL=${accessTtlSeconds}`);
  assert.ok(refreshTtlSeconds >= 1790 && refreshTtlSeconds <= 1810, `refresh TTL=${refreshTtlSeconds}`);

  assert.equal(updates.length, 1);
  const expiresAt = updates[0]?.data?.refreshTokenExpiresAt;
  assert.ok(expiresAt instanceof Date, 'refreshTokenExpiresAt should be date');
});
