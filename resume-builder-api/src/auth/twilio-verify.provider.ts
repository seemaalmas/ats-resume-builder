import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SendOtpResult, SmsProvider, SmsSendContext, VerifyOtpResult } from './sms.provider';

type TwilioVerifyResponse = {
  sid?: string;
  status?: string;
};

@Injectable()
export class TwilioVerifyProvider implements SmsProvider {
  private readonly logger = new Logger(TwilioVerifyProvider.name);

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phoneE164: string, context?: SmsSendContext): Promise<SendOtpResult> {
    const creds = this.readCredentials();
    const url = `${creds.baseUrl}/Services/${encodeURIComponent(creds.verifyServiceSid)}/Verifications`;
    const payload = new URLSearchParams();
    payload.set('To', phoneE164);
    payload.set('Channel', 'sms');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.basicAuth(creds.accountSid, creds.authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload.toString(),
    });

    if (!response.ok) {
      const details = await safeReadBody(response);
      this.logger.warn(`Twilio sendOtp failed status=${response.status} context=${context?.context || 'login'} body=${details}`);
      throw new InternalServerErrorException('Unable to send OTP at this time.');
    }

    const data = await safeReadJson<TwilioVerifyResponse>(response);
    if (!data?.sid) {
      throw new InternalServerErrorException('OTP provider returned an invalid response.');
    }
    return { requestId: data.sid };
  }

  async verifyOtp(phoneE164: string, code: string, requestId: string): Promise<VerifyOtpResult> {
    const creds = this.readCredentials();
    const url = `${creds.baseUrl}/Services/${encodeURIComponent(creds.verifyServiceSid)}/VerificationCheck`;
    const payload = new URLSearchParams();
    payload.set('To', phoneE164);
    payload.set('Code', code);
    payload.set('VerificationSid', requestId);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.basicAuth(creds.accountSid, creds.authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload.toString(),
    });

    if (response.status >= 500) {
      const details = await safeReadBody(response);
      this.logger.warn(`Twilio verifyOtp failed status=${response.status} body=${details}`);
      throw new InternalServerErrorException('Unable to verify OTP at this time.');
    }
    if (!response.ok) {
      return { success: false };
    }

    const data = await safeReadJson<TwilioVerifyResponse>(response);
    return { success: String(data?.status || '').toLowerCase() === 'approved' };
  }

  private readCredentials() {
    const accountSid = String(this.config.get<string>('TWILIO_ACCOUNT_SID', '') || '').trim();
    const authToken = String(this.config.get<string>('TWILIO_AUTH_TOKEN', '') || '').trim();
    const verifyServiceSid = String(this.config.get<string>('TWILIO_VERIFY_SERVICE_SID', '') || '').trim();
    if (!accountSid || !authToken || !verifyServiceSid) {
      throw new InternalServerErrorException(
        'Twilio Verify not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID.',
      );
    }
    return {
      accountSid,
      authToken,
      verifyServiceSid,
      baseUrl: 'https://verify.twilio.com/v2',
    };
  }

  private basicAuth(username: string, password: string) {
    const encoded = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    return `Basic ${encoded}`;
  }
}

async function safeReadBody(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, 240);
  } catch {
    return '';
  }
}

async function safeReadJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}
