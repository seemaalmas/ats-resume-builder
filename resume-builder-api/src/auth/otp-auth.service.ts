import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { getPlanConfig } from '../billing/plan-limits';
import { resetUsageForPlan } from '../billing/usage';
import { AuthService } from './auth.service';
import { normalizeMobile } from './mobile.util';
import { SMS_PROVIDER, type SmsProvider } from './sms.provider';

type CounterEntry = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60 * 60 * 1000;
const phoneSendCounters = new Map<string, CounterEntry>();
const ipSendCounters = new Map<string, CounterEntry>();
const phoneVerifyCounters = new Map<string, CounterEntry>();

@Injectable()
export class OtpAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  async sendOtp(phone: string, meta: { ip?: string; userAgent?: string } = {}) {
    const normalized = normalizeMobile(phone);
    if (!normalized) {
      throw new BadRequestException('Invalid phone number.');
    }
    this.enforceSendRateLimits(normalized, meta.ip);
    return this.smsProvider.sendOtp(normalized, {
      ip: meta.ip,
      userAgent: meta.userAgent,
      context: 'login',
    });
  }

  async verifyOtp(phone: string, code: string, requestId: string) {
    const normalized = normalizeMobile(phone);
    if (!normalized) {
      throw new BadRequestException('Invalid phone number.');
    }
    const cleanCode = String(code || '').trim();
    const cleanRequestId = String(requestId || '').trim();
    if (!/^\d{4,8}$/.test(cleanCode) || !cleanRequestId) {
      throw new BadRequestException('phone, code, and requestId are required.');
    }

    this.enforceVerifyRateLimits(normalized);
    const verified = await this.smsProvider.verifyOtp(normalized, cleanCode, cleanRequestId);
    if (!verified.success) {
      throw new UnauthorizedException('Invalid OTP');
    }
    const user = await this.ensureUser(normalized);
    return this.authService.issueOtpSessionForUser(user);
  }

  private enforceSendRateLimits(phoneE164: string, ip?: string) {
    const phoneLimit = positiveInt(this.config.get<string>('OTP_SEND_LIMIT_PER_PHONE_PER_HOUR', '5'), 5);
    const ipLimit = positiveInt(this.config.get<string>('OTP_SEND_LIMIT_PER_IP_PER_HOUR', '20'), 20);
    if (!consumeCounter(phoneSendCounters, phoneE164, phoneLimit)) {
      throw new HttpException('Too many OTP requests for this phone. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const ipKey = String(ip || '').trim();
    if (ipKey && !consumeCounter(ipSendCounters, ipKey, ipLimit)) {
      throw new HttpException('Too many OTP requests from this IP. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private enforceVerifyRateLimits(phoneE164: string) {
    const verifyLimit = positiveInt(this.config.get<string>('OTP_VERIFY_LIMIT_PER_PHONE_PER_HOUR', '20'), 20);
    if (!consumeCounter(phoneVerifyCounters, phoneE164, verifyLimit)) {
      throw new HttpException('Too many OTP verification attempts for this phone. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
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

function consumeCounter(store: Map<string, CounterEntry>, key: string, limit: number) {
  const now = Date.now();
  const current = store.get(key);
  if (!current || now - current.windowStart > WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (current.count >= limit) {
    return false;
  }
  current.count += 1;
  store.set(key, current);
  return true;
}

function positiveInt(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseAdminMobiles(raw: string) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((entry) => normalizeMobile(entry))
      .filter(Boolean),
  );
}
