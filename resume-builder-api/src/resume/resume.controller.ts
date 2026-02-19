import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ResumeService } from './resume.service';
import {
  AtsScoreRequestSchema,
  CreateResumeSchema,
  DuplicateResumeSchema,
  UpdateResumeSchema,
  type AtsScoreRequestDto,
  type CreateResumeDto,
  type DuplicateResumeDto,
  type UpdateResumeDto,
} from 'resume-builder-shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MulterUploadExceptionFilter } from './multer-upload-exception.filter';
import { z } from 'zod';

const { memoryStorage } = require('multer');
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const SUPPORTED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const optionalTrimmedString = () =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  );

const ParseUploadBodySchema = z.object({
  resumeId: optionalTrimmedString(),
  title: optionalTrimmedString(),
  mode: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.enum(['extract-only', 'extract-and-map']).optional(),
  ),
}).passthrough();

type UploadedResumeFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Controller('resumes')
@UseGuards(JwtAuthGuard)
export class ResumeController {
  constructor(private readonly resumeService: ResumeService) {}

  @Post()
  create(@Req() req: { user: { userId: string } }, @Body() body: CreateResumeDto) {
    const parsed = CreateResumeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(buildZodErrorPayload(parsed.error));
    }
    return this.resumeService.create(req.user.userId, parsed.data);
  }

  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.resumeService.list(req.user.userId);
  }

  @Get(':id')
  get(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.resumeService.get(req.user.userId, id);
  }

  @Patch(':id')
  update(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() body: UpdateResumeDto,
  ) {
    const parsed = UpdateResumeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(buildZodErrorPayload(parsed.error));
    }
    return this.resumeService.update(req.user.userId, id, parsed.data);
  }

  @Post(':id/duplicate')
  duplicate(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() body: DuplicateResumeDto,
  ) {
    const parsed = DuplicateResumeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(buildZodErrorPayload(parsed.error));
    }
    return this.resumeService.duplicate(req.user.userId, id, parsed.data.title);
  }

  @Delete(':id')
  remove(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.resumeService.remove(req.user.userId, id);
  }

  @Post(':id/ats-score')
  atsScore(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() body: AtsScoreRequestDto,
  ) {
    const parsed = AtsScoreRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(buildZodErrorPayload(parsed.error));
    }
    return this.resumeService.atsScoreForResume(req.user.userId, id, parsed.data.jdText);
  }

  @Get(':id/pdf')
  async pdf(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.resumeService.generatePdf(req.user.userId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="resume-${id}.pdf"`);
    res.send(pdfBuffer);
  }

  @Post('parse-upload')
  @HttpCode(200)
  @UseFilters(MulterUploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (req: Request & { fileValidationError?: string }, file: UploadedResumeFile, cb: (error: Error | null, acceptFile: boolean) => void) => {
        const ext = extensionFromName(file.originalname);
        const mime = String(file.mimetype || '').toLowerCase();
        const isSupported = SUPPORTED_UPLOAD_MIME_TYPES.has(mime) || ext === 'pdf' || ext === 'docx' || ext === 'txt';
        if (isSupported) {
          cb(null, true);
          return;
        }
        req.fileValidationError = `unsupported mimetype: ${file.mimetype || 'unknown'}; allowed types are PDF, DOCX, TXT.`;
        cb(null, false);
      },
    }),
  )
  parseUpload(
    @Req() req: Request & { fileValidationError?: string },
    @Body() body: Record<string, unknown>,
    @UploadedFile() file?: UploadedResumeFile,
  ) {
    const parsedBody = ParseUploadBodySchema.safeParse(body || {});
    if (!parsedBody.success) {
      const errors = parsedBody.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'body',
        message: issue.message,
      }));
      logUploadReason(`body validation failed: ${errors.map((item) => `${item.path}: ${item.message}`).join(' | ')}`);
      throw new BadRequestException({ errors });
    }
    if (req.fileValidationError) {
      logUploadReason(req.fileValidationError);
      throw new BadRequestException({ errors: [{ path: 'file', message: req.fileValidationError }] });
    }
    if (!file) {
      const reason = "file field missing; expected multipart field 'file'.";
      logUploadReason(reason);
      throw new BadRequestException({ errors: [{ path: 'file', message: reason }] });
    }
    if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      const reason = 'uploaded file buffer is empty; ensure multipart/form-data includes a valid file payload.';
      logUploadReason(reason);
      throw new BadRequestException({ errors: [{ path: 'file', message: reason }] });
    }
    return this.resumeService.parseResumeUpload({
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    }, parsedBody.data);
  }
}

function extensionFromName(name: string) {
  const parts = String(name || '').toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() || '' : '';
}

function logUploadReason(message: string) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[parse-upload] ${message}`);
  }
}

function buildZodErrorPayload(error: any) {
  const flattened = (error && typeof error.flatten === 'function')
    ? (error.flatten() as Record<string, unknown>)
    : {};
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  return {
    ...flattened,
    errors: issues.map((issue: { path?: unknown; message?: unknown }) => {
      const pathParts = Array.isArray(issue.path) ? issue.path.map((part) => String(part)) : [];
      return {
        path: pathParts.join('.') || 'body',
        message: typeof issue.message === 'string' ? issue.message : 'Invalid request payload.',
      };
    }),
  };
}
