import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import {
  AiCritiqueSchema,
  AiParseJdSchema,
  AiSkillGapSchema,
  type AiCritiqueDto,
  type AiParseJdDto,
  type AiSkillGapDto,
} from 'resume-builder-shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('parse-jd')
  parseJd(@Req() req: { user: { userId: string } }, @Body() body: AiParseJdDto) {
    const parsed = AiParseJdSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.aiService.parseJd(req.user.userId, parsed.data.text);
  }

  @Post('critique')
  critique(@Req() req: { user: { userId: string } }, @Body() body: AiCritiqueDto) {
    const parsed = AiCritiqueSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.aiService.critiqueResume(req.user.userId, parsed.data.resumeText, parsed.data.jdText);
  }

  @Post('skill-gap')
  skillGap(@Req() req: { user: { userId: string } }, @Body() body: AiSkillGapDto) {
    const parsed = AiSkillGapSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.aiService.skillGap(req.user.userId, parsed.data.resumeText, parsed.data.jdText);
  }
}
