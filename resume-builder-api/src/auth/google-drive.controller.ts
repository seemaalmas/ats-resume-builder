import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleDriveService } from './google-drive.service';

@Controller('drive')
@UseGuards(JwtAuthGuard)
export class GoogleDriveController {
  constructor(private readonly googleDrive: GoogleDriveService) {}

  @Get('session')
  getDriveSession(
    @Req() req: Request & { user?: { userId?: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = this.readUserId(req);
    return this.googleDrive.getDriveSessionStatus(req, res, userId);
  }

  @Post('consent')
  setDriveConsent(
    @Req() req: Request & { user?: { userId?: string } },
    @Res({ passthrough: true }) res: Response,
    @Body() body: { decision?: 'accepted' | 'declined' },
  ) {
    const decision = body?.decision === 'accepted' ? 'accepted' : body?.decision === 'declined' ? 'declined' : '';
    if (!decision) {
      throw new BadRequestException('decision must be accepted or declined.');
    }
    const userId = this.readUserId(req);
    return this.googleDrive.setDriveConsent(req, res, userId, decision);
  }

  @Get('files')
  listDriveFiles(
    @Req() req: Request & { user?: { userId?: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = this.readUserId(req);
    return this.googleDrive.listDriveFiles(req, res, userId);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  importDriveFile(
    @Req() req: Request & { user?: { userId?: string } },
    @Res({ passthrough: true }) res: Response,
    @Body() body: { fileId?: string },
  ) {
    const userId = this.readUserId(req);
    return this.googleDrive.importDriveFile(req, res, userId, String(body?.fileId || ''));
  }

  @Post('session/extend')
  extendDriveSession(
    @Req() req: Request & { user?: { userId?: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = this.readUserId(req);
    return this.googleDrive.extendDriveSession(req, res, userId);
  }

  private readUserId(req: Request & { user?: { userId?: string } }) {
    const userId = String(req.user?.userId || '').trim();
    if (!userId) {
      throw new BadRequestException('Unauthorized user context.');
    }
    return userId;
  }
}
