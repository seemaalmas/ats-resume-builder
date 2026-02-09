import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ResumeModule } from './resume/resume.module';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './ai/ai.module';
import { BillingModule } from './billing/billing.module';
import { HealthController } from './health/health.controller';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ResumeModule,
    IntelligenceModule,
    AiModule,
    BillingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
