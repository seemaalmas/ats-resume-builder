import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto, RegisterDto } from 'resume-builder-shared';
import { getPlanConfig } from '../billing/plan-limits';
import { resetUsageForPlan } from '../billing/usage';

const ACCESS_TOKEN_TYPE = 'access';
const REFRESH_TOKEN_TYPE = 'refresh';
const OTP_SESSION_TTL_SECONDS = 30 * 60;

type SessionType = 'default' | 'otp';

type TokenIssueOptions = {
  accessExpiresSeconds: number;
  refreshExpiresSeconds: number;
  sessionType: SessionType;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new UnauthorizedException('Email already registered');
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const planConfig = getPlanConfig('FREE');
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        fullName: dto.fullName,
        passwordHash,
        plan: 'FREE',
        aiTokensLimit: planConfig.aiTokensLimit,
        pdfExportsLimit: planConfig.pdfExportsLimit,
        atsScansLimit: planConfig.atsScansLimit,
        resumesLimit: planConfig.resumesLimit,
      },
      select: { id: true, email: true, fullName: true, mobile: true },
    });
    await resetUsageForPlan(this.prisma, user.id, 'FREE');
    return this.issueTokensForUser(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueTokensForUser(user);
  }

  async refresh(userId: string, refreshToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.refreshTokenHash || !user.refreshTokenExpiresAt) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const expired = user.refreshTokenExpiresAt.getTime() < Date.now();
    if (expired) {
      throw new UnauthorizedException('Refresh token expired');
    }
    const ok = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const sessionType = await this.readSessionTypeFromRefreshToken(refreshToken, userId);
    if (sessionType === 'otp') {
      return this.issueOtpSessionForUser(user);
    }
    return this.issueTokensForUser(user);
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
    });
    return { ok: true };
  }

  async issueTokensForUser(user: { id: string; email: string; fullName: string; mobile?: string | null }) {
    const accessExpires = durationToSeconds(this.config.get<string>('JWT_EXPIRES_IN', '7d'), 7 * 24 * 60 * 60);
    const refreshExpires = durationToSeconds(this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d'), 30 * 24 * 60 * 60);
    return this.issueTokens(user.id, user.email, user.fullName, user.mobile ?? undefined, {
      accessExpiresSeconds: accessExpires,
      refreshExpiresSeconds: refreshExpires,
      sessionType: 'default',
    });
  }

  async issueOtpSessionForUser(user: { id: string; email: string; fullName: string; mobile?: string | null }) {
    const sessionTtl = durationToSeconds(
      this.config.get<string>('OTP_SESSION_EXPIRES_IN', '30m'),
      OTP_SESSION_TTL_SECONDS,
    );
    return this.issueTokens(user.id, user.email, user.fullName, user.mobile ?? undefined, {
      accessExpiresSeconds: sessionTtl,
      refreshExpiresSeconds: sessionTtl,
      sessionType: 'otp',
    });
  }

  private async issueTokens(userId: string, email: string, fullName: string, mobile: string | undefined, options: TokenIssueOptions) {
    const accessExpires = options.accessExpiresSeconds;
    const refreshExpires = options.refreshExpiresSeconds;

    const accessToken = await this.jwt.signAsync(
      {
        sub: userId,
        email,
        typ: ACCESS_TOKEN_TYPE,
        mobile,
        sess: options.sessionType,
      },
      {
        secret: this.config.get<string>('JWT_SECRET', 'dev_secret'),
        expiresIn: accessExpires,
      },
    );

    const refreshToken = await this.jwt.signAsync(
      {
        sub: userId,
        email,
        typ: REFRESH_TOKEN_TYPE,
        mobile,
        sess: options.sessionType,
      },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET', 'dev_refresh_secret'),
        expiresIn: refreshExpires,
      },
    );

    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
    const refreshTokenExpiresAt = new Date(Date.now() + refreshExpires * 1000);

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash, refreshTokenExpiresAt },
    });

    const expiresAt = new Date(Date.now() + accessExpires * 1000).toISOString();

    return {
      user: { id: userId, email, fullName },
      accessToken,
      refreshToken,
      expiresAt,
    };
  }

  private async readSessionTypeFromRefreshToken(refreshToken: string, expectedUserId: string): Promise<SessionType> {
    try {
      const payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET', 'dev_refresh_secret'),
      }) as { sub?: string; typ?: string; sess?: string };
      if (payload?.typ !== REFRESH_TOKEN_TYPE || payload.sub !== expectedUserId) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      return payload.sess === 'otp' ? 'otp' : 'default';
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}

function durationToSeconds(value: string, fallbackSeconds: number): number {
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallbackSeconds;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 60 * 60;
    case 'd':
      return amount * 24 * 60 * 60;
    default:
      return fallbackSeconds;
  }
}
