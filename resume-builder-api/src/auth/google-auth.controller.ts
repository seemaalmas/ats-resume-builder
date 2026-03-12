import { BadRequestException, Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleDriveService } from './google-drive.service';

@Controller('auth')
export class GoogleAuthController {
  constructor(private readonly googleDrive: GoogleDriveService) {}

  @Get('google/start')
  @UseGuards(JwtAuthGuard)
  startGoogleOAuth(
    @Req() req: Request & { user?: { userId?: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = String(req.user?.userId || '').trim();
    if (!userId) {
      throw new BadRequestException('Unauthorized user context.');
    }
    return this.googleDrive.getGoogleStartUrl(req, res, userId);
  }

  @Get('google/callback')
  async googleOAuthCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    const redirectUrl = await this.googleDrive.handleGoogleCallback(req, res, String(code || ''), String(state || ''));
    return res.redirect(302, redirectUrl);
  }
}
