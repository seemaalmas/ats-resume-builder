import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT, type RedisLikeClient } from './redisClient';
import { decryptJson, encryptJson, normalizeTokenEncryptionKey } from './tokenEncryption';

export type GoogleTokenRecord = {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
  scope?: string;
  tokenType?: string;
  idToken?: string;
};

type GoogleTokenEnvelope = GoogleTokenRecord & {
  updatedAt: number;
};

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

@Injectable()
export class GoogleTokenStore {
  private readonly logger = new Logger(GoogleTokenStore.name);
  private keyCache: Buffer | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisLikeClient,
    private readonly config: ConfigService,
  ) {}

  async getGoogleTokens(userId: string): Promise<GoogleTokenRecord | null> {
    const key = this.keyForUser(userId);
    if (!key) return null;
    const encrypted = await this.redis.get(key);
    if (!encrypted) return null;

    try {
      const decoded = decryptJson<GoogleTokenEnvelope>(encrypted, this.getEncryptionKey());
      if (!decoded || typeof decoded !== 'object') {
        await this.redis.del(key);
        return null;
      }
      const accessToken = String(decoded.accessToken || '').trim();
      if (!accessToken) {
        await this.redis.del(key);
        return null;
      }
      return {
        accessToken,
        refreshToken: stringOrUndefined(decoded.refreshToken),
        expiryDate: numberOrUndefined(decoded.expiryDate),
        scope: stringOrUndefined(decoded.scope),
        tokenType: stringOrUndefined(decoded.tokenType),
        idToken: stringOrUndefined(decoded.idToken),
      };
    } catch {
      // Fail safely: clear unreadable data and force re-auth.
      await this.redis.del(key);
      return null;
    }
  }

  async setGoogleTokens(userId: string, tokens: GoogleTokenRecord): Promise<void> {
    const key = this.keyForUser(userId);
    if (!key) return;
    const accessToken = String(tokens.accessToken || '').trim();
    if (!accessToken) {
      throw new Error('accessToken is required.');
    }
    const payload: GoogleTokenEnvelope = {
      accessToken,
      refreshToken: stringOrUndefined(tokens.refreshToken),
      expiryDate: numberOrUndefined(tokens.expiryDate),
      scope: stringOrUndefined(tokens.scope),
      tokenType: stringOrUndefined(tokens.tokenType),
      idToken: stringOrUndefined(tokens.idToken),
      updatedAt: Date.now(),
    };
    const encrypted = encryptJson(payload, this.getEncryptionKey());
    await this.redis.set(key, encrypted, { ex: TOKEN_TTL_SECONDS });
  }

  async clearGoogleTokens(userId: string): Promise<void> {
    const key = this.keyForUser(userId);
    if (!key) return;
    await this.redis.del(key);
  }

  private keyForUser(userId: string) {
    const clean = String(userId || '').trim();
    if (!clean) return '';
    return `google:tokens:${clean}`;
  }

  private getEncryptionKey() {
    if (this.keyCache) return this.keyCache;
    const raw = String(this.config.get<string>('TOKEN_ENC_KEY', '') || '').trim();
    if (!raw) {
      throw new Error('TOKEN_ENC_KEY is required to store Google tokens.');
    }
    this.keyCache = normalizeTokenEncryptionKey(raw);
    this.logger.log('Google token encryption key loaded.');
    return this.keyCache;
  }
}

function stringOrUndefined(value: unknown) {
  const clean = String(value || '').trim();
  return clean || undefined;
}

function numberOrUndefined(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.floor(numeric);
}

