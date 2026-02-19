import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { SettingsService } from '../settings/settings.service';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, AdminAuthGuard)
export class AdminController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings() {
    const rateLimit = await this.settingsService.getResumeCreationRateLimitSetting();
    return {
      flags: {
        resumeCreationRateLimitEnabled: rateLimit.enabled,
      },
      updatedAt: rateLimit.updatedAt ? rateLimit.updatedAt.toISOString() : null,
      forcedDisabled: rateLimit.forcedDisabled,
    };
  }

  @Put('rate-limit')
  async updateRateLimit(@Body() body: { enabled?: unknown }) {
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }
    const updated = await this.settingsService.setResumeCreationRateLimitEnabled(body.enabled);
    return {
      flags: {
        resumeCreationRateLimitEnabled: updated.enabled,
      },
      updatedAt: updated.updatedAt ? updated.updatedAt.toISOString() : null,
      forcedDisabled: updated.forcedDisabled,
    };
  }
}

