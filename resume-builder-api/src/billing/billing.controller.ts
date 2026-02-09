import { BadRequestException, Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CreateCheckoutSessionSchema, type CreateCheckoutSessionDto } from 'resume-builder-shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@Req() req: { user: { userId: string } }, @Body() body: CreateCheckoutSessionDto) {
    const parsed = CreateCheckoutSessionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.billingService.createCheckoutSession(req.user.userId, parsed.data.plan);
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  portal(@Req() req: { user: { userId: string } }) {
    return this.billingService.createPortalSession(req.user.userId);
  }

  @Post('webhook')
  webhook(@Req() req: Request, @Headers('stripe-signature') signature: string) {
    return this.billingService.handleWebhook(req, signature);
  }
}
