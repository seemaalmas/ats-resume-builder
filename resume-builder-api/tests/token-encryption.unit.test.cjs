const assert = require('node:assert/strict');
const test = require('node:test');
const { decryptJson, encryptJson, normalizeTokenEncryptionKey } = require('../dist/auth/tokenEncryption.js');

const HEX_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const BASE64_KEY = Buffer.from(HEX_KEY, 'hex').toString('base64');

test('encryptJson/decryptJson roundtrip with hex key', () => {
  const payload = {
    accessToken: 'access-123',
    refreshToken: 'refresh-456',
    expiryDate: Date.now() + 60_000,
  };
  const encrypted = encryptJson(payload, HEX_KEY);
  assert.equal(typeof encrypted, 'string');
  assert.ok(!encrypted.includes('access-123'));

  const decrypted = decryptJson(encrypted, HEX_KEY);
  assert.deepEqual(decrypted, payload);
});

test('normalizeTokenEncryptionKey accepts base64 and returns 32 bytes', () => {
  const key = normalizeTokenEncryptionKey(BASE64_KEY);
  assert.equal(Buffer.isBuffer(key), true);
  assert.equal(key.length, 32);
});

test('decryptJson fails with a different key', () => {
  const payload = { accessToken: 'secret' };
  const encrypted = encryptJson(payload, HEX_KEY);
  assert.throws(() => decryptJson(encrypted, '1'.repeat(64)));
});

