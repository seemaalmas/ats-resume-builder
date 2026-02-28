import { BadRequestException, Body, Controller, Get, Patch, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { RateLimitSettingState, SettingsService } from '../settings/settings.service';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, AdminAuthGuard)
export class AdminController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings() {
    const rateLimit = await this.settingsService.getResumeCreationRateLimitSetting();
    const paymentFeatureEnabled = await this.settingsService.isPaymentFeatureEnabled();
    return this.buildResponse(rateLimit, paymentFeatureEnabled);
  }

  @Put('rate-limit')
  async updateRateLimit(@Body() body: { enabled?: unknown }) {
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }
    const updated = await this.settingsService.setResumeCreationRateLimitEnabled(body.enabled);
    const paymentFeatureEnabled = await this.settingsService.isPaymentFeatureEnabled();
    return this.buildResponse(updated, paymentFeatureEnabled);
  }

  @Put('payment')
  async updatePayment(@Body() body: { enabled?: unknown }) {
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }
    const updated = await this.settingsService.setPaymentFeatureEnabled(body.enabled);
    const rateLimit = await this.settingsService.getResumeCreationRateLimitSetting();
    return this.buildResponse(rateLimit, updated.enabled);
  }

  @Patch()
  async patchPayment(@Body() body: { paymentFeatureEnabled?: unknown }) {
    if (typeof body?.paymentFeatureEnabled !== 'boolean') {
      throw new BadRequestException('paymentFeatureEnabled must be a boolean');
    }
    const updated = await this.settingsService.setPaymentFeatureEnabled(body.paymentFeatureEnabled);
    const rateLimit = await this.settingsService.getResumeCreationRateLimitSetting();
    return this.buildResponse(rateLimit, updated.enabled);
  }

  private buildResponse(rateLimit: RateLimitSettingState, paymentFeatureEnabled: boolean) {
    return {
      flags: {
        resumeCreationRateLimitEnabled: rateLimit.enabled,
        paymentFeatureEnabled,
      },
      updatedAt: rateLimit.updatedAt ? rateLimit.updatedAt.toISOString() : null,
      forcedDisabled: rateLimit.forcedDisabled,
    };
  }
}

