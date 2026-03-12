const assert = require('node:assert/strict');
const test = require('node:test');
const { GoogleTokenStore } = require('../dist/auth/tokenStore.js');

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

function createMockRedis() {
  const values = new Map();
  const ttl = new Map();
  const deleted = [];
  return {
    values,
    ttl,
    deleted,
    async get(key) {
      return values.has(key) ? values.get(key) : null;
    },
    async set(key, value, options = {}) {
      values.set(key, value);
      ttl.set(key, Number(options.ex || 0));
      return 'OK';
    },
    async del(key) {
      deleted.push(key);
      return values.delete(key) ? 1 : 0;
    },
  };
}

const ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test('GoogleTokenStore writes encrypted payload with 30 day TTL and reads it back', async () => {
  const redis = createMockRedis();
  const store = new GoogleTokenStore(redis, new StubConfig({ TOKEN_ENC_KEY: ENC_KEY }));

  await store.setGoogleTokens('user-1', {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiryDate: Date.now() + 3600_000,
    scope: 'openid email',
    tokenType: 'Bearer',
    idToken: 'id-token',
  });

  const key = 'google:tokens:user-1';
  const persisted = redis.values.get(key);
  assert.equal(typeof persisted, 'string');
  assert.ok(!persisted.includes('access-token'));
  assert.equal(redis.ttl.get(key), 30 * 24 * 60 * 60);

  const loaded = await store.getGoogleTokens('user-1');
  assert.equal(loaded?.accessToken, 'access-token');
  assert.equal(loaded?.refreshToken, 'refresh-token');
  assert.equal(loaded?.tokenType, 'Bearer');
});

test('GoogleTokenStore clears corrupted payload and returns null', async () => {
  const redis = createMockRedis();
  const store = new GoogleTokenStore(redis, new StubConfig({ TOKEN_ENC_KEY: ENC_KEY }));
  const key = 'google:tokens:user-2';
  redis.values.set(key, 'not-valid-ciphertext');

  const result = await store.getGoogleTokens('user-2');
  assert.equal(result, null);
  assert.deepEqual(redis.deleted, [key]);
});

test('GoogleTokenStore clearGoogleTokens removes record', async () => {
  const redis = createMockRedis();
  const store = new GoogleTokenStore(redis, new StubConfig({ TOKEN_ENC_KEY: ENC_KEY }));
  const key = 'google:tokens:user-3';
  redis.values.set(key, 'cipher');

  await store.clearGoogleTokens('user-3');
  assert.equal(redis.values.has(key), false);
});

