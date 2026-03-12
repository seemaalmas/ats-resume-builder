import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { REDIS_CLIENT, type RedisLikeClient } from './redisClient';

export const DRIVE_SESSION_COOKIE = 'rb_drive_session';
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type DriveSessionRecord = {
  id: string;
  userId: string;
  consentAsked: boolean;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
  oauthState?: string;
  oauthStateExpiresAt?: number;
};

export type DriveSessionStatus = {
  driveConsentAsked: boolean;
  googleConnected: boolean;
  sessionExpiresAt: string | null;
};

@Injectable()
export class DriveSessionService {
  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisLikeClient,
  ) {}

  async getStatus(req: Request, userId: string): Promise<DriveSessionStatus> {
    const session = await this.getSession(req, userId);
    return {
      driveConsentAsked: Boolean(session?.consentAsked),
      googleConnected: false,
      sessionExpiresAt: session ? new Date(session.expiresAt).toISOString() : null,
    };
  }

  async ensureSession(req: Request, res: Response, userId: string): Promise<DriveSessionRecord> {
    const existing = await this.getSession(req, userId);
    if (existing) {
      await this.extend(existing);
      this.attachSessionCookie(res, existing.id);
      return existing;
    }

    const now = Date.now();
    const session: DriveSessionRecord = {
      id: randomToken(),
      userId,
      consentAsked: false,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: now + this.readSessionTtlMs(),
    };
    await this.persist(session);
    this.attachSessionCookie(res, session.id);
    return session;
  }

  async getSession(req: Request, userId?: string): Promise<DriveSessionRecord | null> {
    const sessionId = readCookie(req.headers.cookie, DRIVE_SESSION_COOKIE);
    if (!sessionId) return null;
    const session = await this.readSession(sessionId);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      await this.redis.del(sessionKey(sessionId));
      return null;
    }
    if (userId && session.userId !== userId) {
      return null;
    }
    return session;
  }

  async markConsentAsked(session: DriveSessionRecord) {
    session.consentAsked = true;
    await this.extend(session);
  }

  async setOAuthState(session: DriveSessionRecord, state: string) {
    session.oauthState = state;
    session.oauthStateExpiresAt = Date.now() + this.readOAuthStateTtlMs();
    await this.extend(session);
  }

  async consumeOAuthState(session: DriveSessionRecord, state: string): Promise<boolean> {
    const now = Date.now();
    const expected = String(session.oauthState || '');
    const expiresAt = Number(session.oauthStateExpiresAt || 0);
    session.oauthState = undefined;
    session.oauthStateExpiresAt = undefined;
    await this.persist(session);
    if (!expected || !state || expected !== state) return false;
    if (expiresAt <= 0 || expiresAt < now) return false;
    return true;
  }

  async extend(session: DriveSessionRecord) {
    const now = Date.now();
    session.lastActivityAt = now;
    session.expiresAt = now + this.readSessionTtlMs();
    await this.persist(session);
  }

  attachSessionCookie(res: Response, sessionId: string) {
    res.cookie(DRIVE_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isProduction(),
      maxAge: this.readSessionTtlMs(),
      path: '/',
    });
  }

  private readSessionTtlMs() {
    const raw = Number(this.config.get<string>('DRIVE_SESSION_TTL_MS', String(DEFAULT_TTL_MS)));
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_MS;
    return Math.floor(raw);
  }

  private readOAuthStateTtlMs() {
    const raw = Number(this.config.get<string>('DRIVE_OAUTH_STATE_TTL_MS', String(DEFAULT_OAUTH_STATE_TTL_MS)));
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_OAUTH_STATE_TTL_MS;
    return Math.floor(raw);
  }

  private isProduction() {
    return String(this.config.get<string>('NODE_ENV', 'development')).toLowerCase() === 'production';
  }

  private async persist(session: DriveSessionRecord) {
    const ttlMs = Math.max(1, session.expiresAt - Date.now());
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    await this.redis.set(sessionKey(session.id), JSON.stringify(session), { ex: ttlSeconds });
  }

  private async readSession(sessionId: string): Promise<DriveSessionRecord | null> {
    const raw = await this.redis.get(sessionKey(sessionId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as DriveSessionRecord;
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.id || !parsed.userId) return null;
      return {
        id: String(parsed.id),
        userId: String(parsed.userId),
        consentAsked: Boolean(parsed.consentAsked),
        createdAt: Number(parsed.createdAt || 0),
        lastActivityAt: Number(parsed.lastActivityAt || 0),
        expiresAt: Number(parsed.expiresAt || 0),
        oauthState: parsed.oauthState ? String(parsed.oauthState) : undefined,
        oauthStateExpiresAt: parsed.oauthStateExpiresAt ? Number(parsed.oauthStateExpiresAt) : undefined,
      };
    } catch {
      await this.redis.del(sessionKey(sessionId));
      return null;
    }
  }
}

function randomToken() {
  return randomBytes(24).toString('base64url');
}

function sessionKey(sessionId: string) {
  return `drive:session:${sessionId}`;
}

function readCookie(cookieHeader: string | undefined, name: string) {
  const raw = String(cookieHeader || '');
  if (!raw) return '';
  const pairs = raw.split(';');
  for (const pair of pairs) {
    const [k, ...rest] = pair.trim().split('=');
    if (!k || k !== name) continue;
    return decodeURIComponent(rest.join('=') || '');
  }
  return '';
}
