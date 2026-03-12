import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const AES_256_GCM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

export function normalizeTokenEncryptionKey(input: string | Buffer): Buffer {
  if (Buffer.isBuffer(input)) {
    if (input.length !== 32) {
      throw new Error('TOKEN_ENC_KEY must decode to exactly 32 bytes.');
    }
    return Buffer.from(input);
  }

  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('TOKEN_ENC_KEY is required.');
  }

  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const decoded = Buffer.from(padded, 'base64');
  if (decoded.length !== 32) {
    throw new Error('TOKEN_ENC_KEY must be 32 bytes in hex (64 chars) or base64.');
  }
  return decoded;
}

export function encryptJson(payload: unknown, keyInput: string | Buffer): string {
  const key = normalizeTokenEncryptionKey(keyInput);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_256_GCM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${VERSION}.${iv.toString('base64url')}.${authTag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptJson<T>(encoded: string, keyInput: string | Buffer): T {
  const key = normalizeTokenEncryptionKey(keyInput);
  const value = String(encoded || '').trim();
  const [version, ivEncoded, tagEncoded, dataEncoded] = value.split('.');
  if (version !== VERSION || !ivEncoded || !tagEncoded || !dataEncoded) {
    throw new Error('Invalid encrypted payload format.');
  }

  try {
    const iv = Buffer.from(ivEncoded, 'base64url');
    const authTag = Buffer.from(tagEncoded, 'base64url');
    const ciphertext = Buffer.from(dataEncoded, 'base64url');
    const decipher = createDecipheriv(AES_256_GCM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch {
    throw new Error('Unable to decrypt token payload.');
  }
}

