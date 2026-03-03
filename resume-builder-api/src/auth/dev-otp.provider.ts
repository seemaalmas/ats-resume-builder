import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { SendOtpResult, SmsProvider, SmsSendContext, VerifyOtpResult } from './sms.provider';

type OtpRecord = {
  phoneE164: string;
  code: string;
  expiresAt: number;
  attempts: number;
};

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class DevOtpProvider implements SmsProvider {
  private readonly logger = new Logger(DevOtpProvider.name);
  private readonly records = new Map<string, OtpRecord>();

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phoneE164: string, context?: SmsSendContext): Promise<SendOtpResult> {
    const requestId = randomBytes(16).toString('hex');
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    this.records.set(requestId, {
      phoneE164,
      code,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
    });
    if (this.config.get<string>('NODE_ENV', 'development') !== 'production') {
      const ip = context?.ip ? ` ip=${context.ip}` : '';
      this.logger.debug(`OTP requestId=${requestId} phone=${phoneE164} code=${code}${ip}`);
      console.log(`OTP requestId=${requestId} phone=${phoneE164} code=${code}`);
    }
    return { requestId };
  }

  async verifyOtp(phoneE164: string, code: string, requestId: string): Promise<VerifyOtpResult> {
    const record = this.records.get(requestId);
    if (!record) return { success: false };
    if (record.phoneE164 !== phoneE164) return { success: false };
    if (record.expiresAt < Date.now()) {
      this.records.delete(requestId);
      return { success: false };
    }
    if (record.attempts >= MAX_ATTEMPTS) return { success: false };
    if (record.code !== code) {
      record.attempts += 1;
      this.records.set(requestId, record);
      return { success: false };
    }
    this.records.delete(requestId);
    return { success: true };
  }
}
