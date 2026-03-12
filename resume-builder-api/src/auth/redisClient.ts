import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';

export type RedisSetOptions = {
  ex?: number;
};

export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: RedisSetOptions): Promise<unknown>;
  del(key: string): Promise<number>;
}

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Injectable()
export class RedisClientService implements RedisLikeClient {
  private readonly logger = new Logger(RedisClientService.name);
  private readonly upstash: Redis | null;
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();
  private readonly useMemoryFallback: boolean;

  constructor(private readonly config: ConfigService) {
    const url = String(this.config.get<string>('REDIS_URL', '') || '').trim();
    const token = String(this.config.get<string>('REDIS_TOKEN', '') || '').trim();
    const isProduction = String(this.config.get<string>('NODE_ENV', 'development')).toLowerCase() === 'production';

    if (url && token) {
      this.upstash = new Redis({ url, token });
      this.useMemoryFallback = false;
      return;
    }

    if (isProduction) {
      throw new Error('REDIS_URL and REDIS_TOKEN must be configured in production.');
    }

    this.upstash = null;
    this.useMemoryFallback = true;
    this.logger.warn('REDIS_URL/REDIS_TOKEN missing. Using in-memory fallback store for local development.');
  }

  async get(key: string): Promise<string | null> {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) return null;
    if (this.upstash) {
      const value = await this.upstash.get(cleanKey);
      if (value === null || value === undefined) return null;
      return String(value);
    }
    return this.memoryGet(cleanKey);
  }

  async set(key: string, value: string, options: RedisSetOptions = {}): Promise<unknown> {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) return 'OK';
    if (this.upstash) {
      const ttlSeconds = readTtl(options.ex);
      if (ttlSeconds > 0) {
        return this.upstash.set(cleanKey, value, { ex: ttlSeconds });
      }
      return this.upstash.set(cleanKey, value);
    }
    this.memorySet(cleanKey, String(value), readTtl(options.ex));
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) return 0;
    if (this.upstash) {
      return Number(await this.upstash.del(cleanKey)) || 0;
    }
    return this.memory.delete(cleanKey) ? 1 : 0;
  }

  private memoryGet(key: string) {
    if (!this.useMemoryFallback) return null;
    const record = this.memory.get(key);
    if (!record) return null;
    if (record.expiresAt > 0 && record.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return record.value;
  }

  private memorySet(key: string, value: string, ttlSeconds: number) {
    const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0;
    this.memory.set(key, { value, expiresAt });
  }
}

function readTtl(value?: number) {
  const ttl = Number(value || 0);
  if (!Number.isFinite(ttl) || ttl <= 0) return 0;
  return Math.max(1, Math.floor(ttl));
}

