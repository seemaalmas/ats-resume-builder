export type SmsSendContext = {
  ip?: string;
  userAgent?: string;
  context?: string;
};

export type SendOtpResult = {
  requestId: string;
};

export type VerifyOtpResult = {
  success: boolean;
};

export interface SmsProvider {
  sendOtp(phoneE164: string, context?: SmsSendContext): Promise<SendOtpResult>;
  verifyOtp(phoneE164: string, code: string, requestId: string): Promise<VerifyOtpResult>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
