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
      select: { id: true, email: true, fullName: true },
    });
    await resetUsageForPlan(this.prisma, user.id, 'FREE');
    return this.issueTokens(user.id, user.email, user.fullName);
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
    return this.issueTokens(user.id, user.email, user.fullName);
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
    return this.issueTokens(user.id, user.email, user.fullName);
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
    });
    return { ok: true };
  }

  private async issueTokens(userId: string, email: string, fullName: string) {
    const accessExpires = durationToSeconds(this.config.get<string>('JWT_EXPIRES_IN', '7d'));
    const refreshExpires = durationToSeconds(this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d'));

    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, typ: ACCESS_TOKEN_TYPE },
      {
        secret: this.config.get<string>('JWT_SECRET', 'dev_secret'),
        expiresIn: accessExpires,
      },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: userId, email, typ: REFRESH_TOKEN_TYPE },
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

    return {
      user: { id: userId, email, fullName },
      accessToken,
      refreshToken,
    };
  }
}

function durationToSeconds(value: string): number {
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 30 * 24 * 60 * 60;
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
      return 30 * 24 * 60 * 60;
  }
}
