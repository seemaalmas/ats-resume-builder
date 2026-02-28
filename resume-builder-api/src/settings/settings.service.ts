import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { APP_SETTING_SINGLETON_ID } from './settings.constants';

export type RateLimitSettingState = {
  enabled: boolean;
  updatedAt: Date | null;
  forcedDisabled: boolean;
};

export type PaymentFeatureSettingState = {
  enabled: boolean;
  updatedAt: Date | null;
};

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureDefaults();
  }

  async ensureDefaults() {
    const defaultValue = this.resolveDefaultRateLimitEnabled();
    try {
      await this.prisma.appSetting.upsert({
        where: { id: APP_SETTING_SINGLETON_ID },
        update: { rateLimitEnabled: defaultValue },
        create: {
          id: APP_SETTING_SINGLETON_ID,
          rateLimitEnabled: defaultValue,
          paymentFeatureEnabled: false,
        },
      });
    } catch (error: unknown) {
      if (isMissingAppSettingTableError(error)) {
        const msg =
          'AppSetting table is missing. Run `npx prisma migrate deploy` (or `npx prisma migrate dev`) to sync your schema before starting the app.';
        this.logger.error(msg, error as Error);
        throw new Error(msg);
      }
      throw error;
    }
  }

  async getResumeCreationRateLimitSetting(): Promise<RateLimitSettingState> {
    const forcedDisabled = this.isForceDisableRateLimit();
    const defaultValue = this.resolveDefaultRateLimitEnabled();
    const setting = await this.prisma.appSetting.findUnique({
      where: { id: APP_SETTING_SINGLETON_ID },
    });
    const enabled = setting?.rateLimitEnabled ?? defaultValue;
    return {
      enabled: forcedDisabled ? false : enabled,
      updatedAt: setting?.updatedAt ?? null,
      forcedDisabled,
    };
  }

  async isRateLimitEnabled() {
    const current = await this.getResumeCreationRateLimitSetting();
    return current.enabled;
  }

  async setResumeCreationRateLimitEnabled(enabled: boolean): Promise<RateLimitSettingState> {
    const updated = await this.prisma.appSetting.upsert({
      where: { id: APP_SETTING_SINGLETON_ID },
      update: { rateLimitEnabled: enabled },
      create: {
        id: APP_SETTING_SINGLETON_ID,
        rateLimitEnabled: enabled,
        paymentFeatureEnabled: false,
      },
    });
    const forcedDisabled = this.isForceDisableRateLimit();
    return {
      enabled: forcedDisabled ? false : updated.rateLimitEnabled,
      updatedAt: updated.updatedAt,
      forcedDisabled,
    };
  }

  async isPaymentFeatureEnabled(): Promise<boolean> {
    const setting = await this.prisma.appSetting.findUnique({
      where: { id: APP_SETTING_SINGLETON_ID },
    });
    return Boolean(setting?.paymentFeatureEnabled);
  }

  async setPaymentFeatureEnabled(enabled: boolean): Promise<PaymentFeatureSettingState> {
    const updated = await this.prisma.appSetting.upsert({
      where: { id: APP_SETTING_SINGLETON_ID },
      update: { paymentFeatureEnabled: enabled },
      create: {
        id: APP_SETTING_SINGLETON_ID,
        rateLimitEnabled: this.resolveDefaultRateLimitEnabled(),
        paymentFeatureEnabled: enabled,
      },
    });
    return {
      enabled: updated.paymentFeatureEnabled,
      updatedAt: updated.updatedAt ?? null,
    };
  }

  private resolveDefaultRateLimitEnabled() {
    const raw = process.env.RESUME_CREATION_RATE_LIMIT_DEFAULT;
    if (raw != null && String(raw).trim() !== '') {
      return parseBoolean(raw, false);
    }
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      return false;
    }
    return false;
  }

  private isForceDisableRateLimit() {
    const raw = process.env.FORCE_DISABLE_RATE_LIMIT;
    if (raw == null || String(raw).trim() === '') return false;
    const knownTrue = parseKnownBoolean(raw);
    if (knownTrue == null) {
      this.logger.warn(`Invalid FORCE_DISABLE_RATE_LIMIT value "${raw}", expected true/false.`);
      return false;
    }
    return knownTrue;
  }
}

function parseBoolean(input: string | null | undefined, fallback: boolean) {
  if (input == null || String(input).trim() === '') return fallback;
  const parsed = parseKnownBoolean(input);
  return parsed == null ? fallback : parsed;
}

function parseKnownBoolean(input: string) {
  const value = String(input).trim().toLowerCase();
  if (value === 'true' || value === '1' || value === 'yes' || value === 'on') return true;
  if (value === 'false' || value === '0' || value === 'no' || value === 'off') return false;
  return null;
}

function isMissingAppSettingTableError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const anyError = error as { code?: string; message?: string };
  const message = typeof anyError.message === 'string' ? anyError.message : '';
  const hasTableMention = /AppSetting/.test(message) && /The table/.test(message);
  return (anyError.code === 'P2021' || hasTableMention) && hasTableMention;
}
