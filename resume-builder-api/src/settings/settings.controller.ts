import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('public')
  async getPublicFlags() {
    const paymentFeatureEnabled = await this.settingsService.isPaymentFeatureEnabled();
    return { paymentFeatureEnabled };
  }
}
