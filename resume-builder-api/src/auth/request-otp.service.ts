import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { GsmModemSender } from './sms.gateway';
import { normalizeMobile } from './mobile.util';

const HASH_ROUNDS = 12;
const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS_PER_IP = 10;

type CounterEntry = { count: number; windowStart: number };
const ipCounters = new Map<string, CounterEntry>();

@Injectable()
export class RequestOtpService {
  private readonly logger = new Logger(RequestOtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsSender: GsmModemSender,
    private readonly config: ConfigService,
  ) {}

  async requestOtp(mobile: string, meta: { ip?: string; userAgent?: string } = {}) {
    const normalized = normalizeMobile(mobile);
    if (!normalized) {
      throw new BadRequestException('Invalid mobile');
    }
    const now = Date.now();
    const latestChallenge = await this.prisma.otpChallenge.findFirst({
      where: { mobile: normalized },
      orderBy: { createdAt: 'desc' },
    });

    if (latestChallenge?.lockedUntil && latestChallenge.lockedUntil.getTime() > now) {
      throw new HttpException('Too many attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (latestChallenge && now - latestChallenge.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new HttpException('OTP already sent. Please wait 60 seconds.', HttpStatus.TOO_MANY_REQUESTS);
    }

    this.enforceIpRateLimit(meta.ip);
    const otp = this.generateOtp();
    const otpHash = await bcrypt.hash(otp, HASH_ROUNDS);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.prisma.otpChallenge.deleteMany({ where: { mobile: normalized } });
    await this.prisma.otpChallenge.create({
      data: {
        mobile: normalized,
        otpHash,
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });

    if (this.isProduction()) {
      await this.smsSender.send(normalized, `Your Resume Builder verification code is ${otp}`);
      return { ok: true };
    }

    this.logger.debug(`OTP for ${normalized} is ${otp}`);
    console.log(`OTP for ${normalized} is ${otp}`);
    return { ok: true, devOtp: otp };
  }

  private isProduction() {
    return this.config.get<string>('NODE_ENV', 'development') === 'production';
  }

  private generateOtp() {
    return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  }

  private enforceIpRateLimit(ip?: string) {
    const ipKey = String(ip || '').trim();
    if (ipKey && !consumeCounter(ipCounters, ipKey, MAX_REQUESTS_PER_IP)) {
      throw new HttpException('Too many OTP requests from this IP. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

function consumeCounter(store: Map<string, CounterEntry>, key: string, limit: number) {
  const now = Date.now();
  const current = store.get(key);
  if (!current || now - current.windowStart > RATE_LIMIT_WINDOW_MS) {
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
