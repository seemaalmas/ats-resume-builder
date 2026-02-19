import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ResumeModule } from './resume/resume.module';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './ai/ai.module';
import { BillingModule } from './billing/billing.module';
import { HealthController } from './health/health.controller';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { CompaniesModule } from './companies/companies.module';
import { MetaModule } from './meta/meta.module';
import { SettingsModule } from './settings/settings.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        '.env.local',
        `.env.${process.env.NODE_ENV || 'development'}`,
        '.env',
      ],
    }),
    PrismaModule,
    AuthModule,
    SettingsModule,
    ResumeModule,
    AdminModule,
    IntelligenceModule,
    AiModule,
    BillingModule,
    CompaniesModule,
    MetaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
