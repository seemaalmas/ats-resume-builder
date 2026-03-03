import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { normalizeMobile } from './mobile.util';
import { getPlanConfig } from '../billing/plan-limits';
import { resetUsageForPlan } from '../billing/usage';

const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 10 * 60 * 1000;

@Injectable()
export class VerifyOtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  async verifyOtp(mobile: string, otp: string) {
    const normalized = normalizeMobile(mobile);
    if (!normalized) {
      throw new BadRequestException('Invalid mobile');
    }
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { mobile: normalized },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) {
      throw new UnauthorizedException('OTP not requested');
    }
    const now = new Date();
    if (challenge.lockedUntil && challenge.lockedUntil > now) {
      throw new HttpException('Too many attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (challenge.expiresAt.getTime() < now.getTime()) {
      throw new UnauthorizedException('OTP expired');
    }
    const isValid = await bcrypt.compare(otp, challenge.otpHash);
    if (!isValid) {
      const nextAttempts = challenge.attempts + 1;
      const updates: { attempts: number; lockedUntil?: Date } = { attempts: nextAttempts };
      if (nextAttempts >= MAX_ATTEMPTS) {
        updates.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
      }
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: updates });
      throw new UnauthorizedException('Invalid OTP');
    }
    await this.prisma.otpChallenge.deleteMany({ where: { mobile: normalized } });
    const user = await this.ensureUser(normalized);
    return this.authService.issueOtpSessionForUser(user);
  }

  private async ensureUser(mobile: string) {
    const adminMobiles = parseAdminMobiles(this.config.get<string>('ADMIN_MOBILES', '+919307009427'));
    const shouldBeAdmin = adminMobiles.has(mobile);
    const existing = await this.prisma.user.findUnique({
      where: { mobile },
      select: { id: true, email: true, fullName: true, mobile: true, isAdmin: true },
    });
    if (existing) {
      if (shouldBeAdmin && !existing.isAdmin) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: { isAdmin: true },
          select: { id: true, email: true, fullName: true, mobile: true, isAdmin: true },
        });
      }
      return existing;
    }
    const planConfig = getPlanConfig('FREE');
    const placeholderEmail = `otp${mobile.replace(/\D/g, '')}@mobile.resume`;
    const passwordHash = await bcrypt.hash(randomBytes(16).toString('hex'), 12);
    const user = await this.prisma.user.create({
      data: {
        email: placeholderEmail,
        fullName: 'Mobile User',
        passwordHash,
        plan: 'FREE',
        aiTokensLimit: planConfig.aiTokensLimit,
        pdfExportsLimit: planConfig.pdfExportsLimit,
        atsScansLimit: planConfig.atsScansLimit,
        resumesLimit: planConfig.resumesLimit,
        mobile,
        isAdmin: shouldBeAdmin,
      },
      select: { id: true, email: true, fullName: true, mobile: true, isAdmin: true },
    });
    await resetUsageForPlan(this.prisma, user.id, 'FREE');
    return user;
  }
}

function parseAdminMobiles(raw: string) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((entry) => normalizeMobile(entry))
      .filter(Boolean),
  );
}
