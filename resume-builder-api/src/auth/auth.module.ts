import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { GsmModemSender } from './sms.gateway';
import { RequestOtpService } from './request-otp.service';
import { VerifyOtpService } from './verify-otp.service';
import { OtpController } from './otp.controller';
import { OtpAuthService } from './otp-auth.service';
import { SMS_PROVIDER } from './sms.provider';
import { TwilioVerifyProvider } from './twilio-verify.provider';
import { DevOtpProvider } from './dev-otp.provider';
import { ResumeModule } from '../resume/resume.module';
import { GoogleAuthController } from './google-auth.controller';
import { GoogleDriveController } from './google-drive.controller';
import { DriveSessionService } from './drive-session.service';
import { GOOGLE_DRIVE_CLIENT, GoogleDriveHttpClient, GoogleDriveService } from './google-drive.service';
import { REDIS_CLIENT, RedisClientService } from './redisClient';
import { GoogleTokenStore } from './tokenStore';

@Module({
  imports: [
    ConfigModule,
    ResumeModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev_secret'),
        signOptions: {
          expiresIn: durationToSeconds(config.get<string>('JWT_EXPIRES_IN', '7d')),
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    GsmModemSender,
    RequestOtpService,
    VerifyOtpService,
    OtpAuthService,
    TwilioVerifyProvider,
    DevOtpProvider,
    DriveSessionService,
    RedisClientService,
    GoogleTokenStore,
    GoogleDriveService,
    GoogleDriveHttpClient,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, TwilioVerifyProvider, DevOtpProvider],
      useFactory: (config: ConfigService, twilio: TwilioVerifyProvider, dev: DevOtpProvider) => {
        const provider = String(config.get<string>('SMS_PROVIDER', 'twilio') || '').trim().toLowerCase();
        if (provider === 'twilio') return twilio;
        return dev;
      },
    },
    {
      provide: GOOGLE_DRIVE_CLIENT,
      useExisting: GoogleDriveHttpClient,
    },
    {
      provide: REDIS_CLIENT,
      useExisting: RedisClientService,
    },
  ],
  controllers: [AuthController, OtpController, GoogleAuthController, GoogleDriveController],
  exports: [AuthService],
})
export class AuthModule {}

function durationToSeconds(value: string): number {
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 7 * 24 * 60 * 60;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 60 * 60;
    case 'd':
      return amount * 24 * 60 * 60;
    default:
      return 7 * 24 * 60 * 60;
  }
}
