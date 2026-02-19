import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { SettingsModule } from '../settings/settings.module';
import { AdminAuthGuard } from '../auth/admin-auth.guard';

@Module({
  imports: [SettingsModule],
  controllers: [AdminController],
  providers: [AdminAuthGuard],
})
export class AdminModule {}

