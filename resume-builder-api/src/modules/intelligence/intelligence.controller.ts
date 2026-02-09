import { BadRequestException, Body, Controller, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IntelligenceService } from './intelligence.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

const { memoryStorage } = require('multer');

type UploadedResumeFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

@Controller('resumes')
@UseGuards(JwtAuthGuard)
export class IntelligenceController {
  constructor(private readonly intelligenceService: IntelligenceService) {}

  @Post(':id/ingest')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  ingest(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @UploadedFile() file?: UploadedResumeFile,
  ) {
    if (!file) {
      throw new BadRequestException({ errors: ['Resume file is required.'] });
    }
    return this.intelligenceService.ingest(req.user.userId, id, {
      originalname: file.originalname,
      mimetype: file.mimetype,
      buffer: file.buffer,
    });
  }

  @Post(':id/recompute')
  recompute(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() _body: Record<string, never>,
  ) {
    return this.intelligenceService.recompute(req.user.userId, id);
  }
}
