import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ensureUsagePeriod } from '../billing/usage';
import { rateLimitOrThrow } from '../limits/rate-limit';

@Injectable()
export class AiService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async parseJd(userId: string, text: string) {
    rateLimitOrThrow({
      key: `ai:parse-jd:${userId}`,
      limit: 20,
      windowMs: 60_000,
      message: 'Rate limit exceeded for JD parsing.',
    });
    const tokens = estimateTokens(text);
    await this.checkAndCharge(userId, tokens);
    try {
      return await this.callAi('/ai/parse-jd', { text });
    } catch {
      return fallbackParseJd(text);
    }
  }

  async critiqueResume(userId: string, resumeText: string, jdText?: string) {
    rateLimitOrThrow({
      key: `ai:critique:${userId}`,
      limit: 10,
      windowMs: 60_000,
      message: 'Rate limit exceeded for resume critique.',
    });
    const payload = {
      resumeText: trimToMaxChars(resumeText, 4000),
      jdText: jdText ? trimToMaxChars(jdText, 3000) : undefined,
    };
    const tokens = estimateTokens(payload.resumeText) + estimateTokens(payload.jdText || '');
    await this.checkAndCharge(userId, tokens);
    try {
      return await this.callAi('/ai/critique', payload);
    } catch {
      return fallbackCritique(payload.resumeText);
    }
  }

  async skillGap(userId: string, resumeText: string, jdText: string) {
    rateLimitOrThrow({
      key: `ai:skill-gap:${userId}`,
      limit: 15,
      windowMs: 60_000,
      message: 'Rate limit exceeded for skill gap analysis.',
    });
    const payload = {
      resumeText: trimToMaxChars(resumeText, 4000),
      jdText: trimToMaxChars(jdText, 3000),
    };
    const tokens = estimateTokens(payload.resumeText) + estimateTokens(payload.jdText);
    await this.checkAndCharge(userId, tokens);
    try {
      return await this.callAi('/ai/skill-gap', payload);
    } catch {
      return fallbackSkillGap(payload.resumeText, payload.jdText);
    }
  }

  private async callAi(path: string, body: unknown) {
    const baseUrl = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:7001');
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ForbiddenException(text || 'AI service error');
    }
    return res.json();
  }

  private async checkAndCharge(userId: string, tokens: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new ForbiddenException('User not found');
    }
    if (user.plan === 'FREE') {
      throw new ForbiddenException('Free plan does not allow AI suggestions.');
    }
    await ensureUsagePeriod(this.prisma, user);
    const updated = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!updated) {
      throw new ForbiddenException('User not found');
    }
    if (updated.aiTokensUsed + tokens > updated.aiTokensLimit) {
      throw new ForbiddenException('AI usage limit exceeded');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { aiTokensUsed: updated.aiTokensUsed + tokens },
    });
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function trimToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function fallbackParseJd(text: string) {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  const skills = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([t]) => t);
  return { skills, responsibilities: [], seniority: 'mid' };
}

function fallbackCritique(resumeText: string) {
  const short = resumeText.replace(/\s+/g, ' ').trim();
  return {
    highlights: short ? [short.slice(0, 80)] : ['Add a concise summary at the top.'],
    weaknesses: ['Add measurable outcomes and role-specific keywords.'],
    rewrittenSummary: short.slice(0, 160),
  };
}

function fallbackSkillGap(resumeText: string, jdText: string) {
  const resumeTokens = new Set(
    resumeText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean),
  );
  const jdTokens = jdText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
  const missingSkills = Array.from(new Set(jdTokens)).filter((t) => !resumeTokens.has(t)).slice(0, 10);
  return { missingSkills, recommendedKeywords: missingSkills.slice(0, 6) };
}
