import { BadRequestException, Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequestOtpService } from './request-otp.service';
import { VerifyOtpService } from './verify-otp.service';
import { OtpAuthService } from './otp-auth.service';

@Controller('auth')
export class OtpController {
  constructor(
    private readonly otpAuthService: OtpAuthService,
    private readonly requestOtpService: RequestOtpService,
    private readonly verifyOtpService: VerifyOtpService,
  ) {}

  @Post('otp/send')
  @HttpCode(200)
  sendOtp(@Body('phone') phone?: string, @Req() req?: Request) {
    if (!phone) {
      throw new BadRequestException('phone is required');
    }
    const meta = {
      ip: req?.ip,
      userAgent: req?.headers['user-agent'] as string | undefined,
    };
    return this.otpAuthService.sendOtp(phone, meta);
  }

  @Post('otp/verify')
  @HttpCode(200)
  verifyOtpV2(@Body() body: { phone?: string; code?: string; requestId?: string }) {
    if (!body?.phone || !body?.code || !body?.requestId) {
      throw new BadRequestException('phone, code, and requestId are required');
    }
    return this.otpAuthService.verifyOtp(body.phone, body.code, body.requestId);
  }

  @Post('request-otp')
  requestOtp(@Body('mobile') mobile?: string, @Req() req?: Request) {
    if (!mobile) {
      throw new BadRequestException('mobile is required');
    }
    const meta = {
      ip: req?.ip,
      userAgent: req?.headers['user-agent'] as string | undefined,
    };
    return this.requestOtpService.requestOtp(mobile, meta);
  }

  @Post('verify-otp')
  verifyOtp(@Body() body: { mobile?: string; otp?: string }) {
    if (!body?.mobile || !body?.otp) {
      throw new BadRequestException('mobile and otp are required');
    }
    return this.verifyOtpService.verifyOtp(body.mobile, body.otp);
  }
}
