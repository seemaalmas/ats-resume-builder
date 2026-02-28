import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, Optional, UnprocessableEntityException } from '@nestjs/common';
import puppeteer from 'puppeteer';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AtsIssue, CreateResumeDto, UpdateResumeDto } from 'resume-builder-shared';
import { ResumeSectionsSchema } from 'resume-schemas';
import { ensureUsagePeriod } from '../billing/usage';
import { rateLimitOrThrow } from '../limits/rate-limit';
import { mapParsedResume, parseResumeText } from 'resume-intelligence';
import type { ParsedResumeText } from 'resume-intelligence';
import { sanitizeImportedResume } from './import-sanitizer';
import { ACTION_VERB_REQUIRED_RATIO, analyzeActionVerbRule, type ActionVerbFailure } from './action-verb-rule';
import { SettingsService } from '../settings/settings.service';
const KNOWN_SPOKEN_LANGUAGES = new Map<string, string>([
  ['english', 'English'],
  ['hindi', 'Hindi'],
  ['urdu', 'Urdu'],
  ['bengali', 'Bengali'],
  ['marathi', 'Marathi'],
  ['tamil', 'Tamil'],
  ['telugu', 'Telugu'],
  ['kannada', 'Kannada'],
  ['malayalam', 'Malayalam'],
  ['gujarati', 'Gujarati'],
  ['punjabi', 'Punjabi'],
  ['odia', 'Odia'],
  ['assamese', 'Assamese'],
  ['sanskrit', 'Sanskrit'],
  ['spanish', 'Spanish'],
  ['french', 'French'],
  ['german', 'German'],
  ['italian', 'Italian'],
  ['portuguese', 'Portuguese'],
  ['japanese', 'Japanese'],
  ['chinese', 'Chinese'],
  ['mandarin', 'Mandarin'],
  ['korean', 'Korean'],
  ['arabic', 'Arabic'],
  ['russian', 'Russian'],
]);
const MIN_PDF_ATS_SCORE = 70;
const FREE_PLAN_RESUME_LIMIT = 2;
const FREE_PLAN_ATS_LIMIT = 2;
export const RESUME_CREATE_RATE_LIMIT = 10;
export const RESUME_CREATE_RATE_WINDOW_MS = 60_000;
export const RESUME_CREATE_RATE_LIMIT_MESSAGE = 'Rate limit exceeded for resume creation.';
export const RESUME_CREATE_RATE_LIMIT_CODE = 'RESUME_CREATE_RATE_LIMITED';

@Injectable()
export class ResumeService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly settingsService?: SettingsService,
  ) {}

  async create(userId: string, dto: CreateResumeDto) {
    await this.enforceResumeCreateRateLimit(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await ensureUsagePeriod(this.prisma, user);
    const refreshedUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!refreshedUser) {
      throw new NotFoundException('User not found');
    }
    const normalizedUser = await ensureFreePlanFloors(this.prisma, refreshedUser);
    const paymentFeatureEnabled = await this.isPaymentFeatureEnabled();
    const resumeCount = await this.prisma.resume.count({ where: { userId } });
    if (paymentFeatureEnabled && resumeCount + 1 > normalizedUser.resumesLimit) {
      if (normalizedUser.plan === 'FREE') {
        throw new ForbiddenException('FREE_PLAN_RESUME_LIMIT_EXCEEDED: Free plan allows up to 2 resumes.');
      }
      throw new ForbiddenException('Resume limit exceeded for your plan.');
    }
    const normalized = validateResumeSectionsOrThrow({
      title: dto.title,
      contact: dto.contact ?? undefined,
      summary: dto.summary,
      skills: dto.skills ?? [],
      technicalSkills: dto.technicalSkills ?? [],
      softSkills: dto.softSkills ?? [],
      languages: dto.languages ?? [],
      experience: dto.experience ?? [],
      education: dto.education ?? [],
      projects: dto.projects ?? [],
      certifications: dto.certifications ?? [],
    });
    const templateId = typeof dto.templateId === 'string'
      ? String(dto.templateId || '').trim() || undefined
      : undefined;
    const categories = resolveSkillCategories({
      skills: normalized.skills,
      technicalSkills: normalized.technicalSkills,
      softSkills: normalized.softSkills,
    });
    enforceAtsResumeRules({
      summary: normalized.summary,
      skills: categories.skills,
      experience: normalized.experience,
      education: normalized.education,
    });
    const created = await this.prisma.resume.create({
      data: {
        userId,
        title: normalized.title,
        contact: attachSkillCategoriesToContact(normalized.contact, categories),
        skills: categories.skills,
        languages: categories.languages,
        summary: normalized.summary,
        experience: normalized.experience,
        education: normalized.education,
        projects: normalized.projects ?? [],
        certifications: normalized.certifications ?? [],
        templateId,
      },
    });
    return decorateResumeWithSkillCategories(created);
  }

  private async enforceResumeCreateRateLimit(userId: string) {
    const isEnabled = this.settingsService
      ? await this.settingsService.isRateLimitEnabled()
      : defaultResumeCreateRateLimitEnabled();
    if (!isEnabled) return;
    try {
      rateLimitOrThrow({
        key: `resume:create:${userId}`,
        limit: RESUME_CREATE_RATE_LIMIT,
        windowMs: RESUME_CREATE_RATE_WINDOW_MS,
        message: RESUME_CREATE_RATE_LIMIT_MESSAGE,
      });
    } catch (error: unknown) {
      if (isHttpExceptionWithStatus(error, HttpStatus.TOO_MANY_REQUESTS)) {
        throw new HttpException(
          {
            code: RESUME_CREATE_RATE_LIMIT_CODE,
            message: RESUME_CREATE_RATE_LIMIT_MESSAGE,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw error;
    }
  }

  async list(userId: string) {
    const rows = await this.prisma.resume.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => decorateResumeWithSkillCategories(row));
  }

  async get(userId: string, id: string) {
    const resume = await this.getRaw(userId, id);
    return decorateResumeWithSkillCategories(resume);
  }

  private async getRaw(userId: string, id: string) {
    const resume = await this.prisma.resume.findFirst({
      where: { id, userId },
    });
    if (!resume) {
      throw new NotFoundException('Resume not found');
    }
    return resume;
  }

  async update(userId: string, id: string, dto: UpdateResumeDto) {
    rateLimitOrThrow({
      key: `resume:update:${userId}`,
      limit: 20,
      windowMs: 60_000,
      message: 'Rate limit exceeded for resume updates.',
    });
    const current = await this.getRaw(userId, id);
    const currentCategories = readSkillCategoriesFromContact(current.contact);
    const normalized = validateResumeSectionsOrThrow({
      title: dto.title ?? current.title,
      contact: dto.contact ?? (current.contact as Record<string, unknown> | undefined),
      summary: dto.summary ?? current.summary,
      skills: dto.skills ?? (Array.isArray(current.skills) ? current.skills : []),
      technicalSkills: dto.technicalSkills ?? currentCategories.technicalSkills,
      softSkills: dto.softSkills ?? currentCategories.softSkills,
      languages: dto.languages ?? (Array.isArray((current as any).languages) ? ((current as any).languages as string[]) : []),
      experience: dto.experience ?? (Array.isArray(current.experience) ? current.experience as any[] : []),
      education: dto.education ?? (Array.isArray(current.education) ? current.education as any[] : []),
      projects: dto.projects ?? (Array.isArray(current.projects) ? current.projects as any[] : []),
      certifications: dto.certifications ?? (Array.isArray(current.certifications) ? current.certifications as any[] : []),
    });
    const categories = resolveSkillCategories({
      skills: normalized.skills,
      technicalSkills: normalized.technicalSkills,
      softSkills: normalized.softSkills,
    });
    enforceAtsResumeRules({
      summary: normalized.summary,
      skills: categories.skills,
      experience: normalized.experience,
      education: normalized.education,
    });
    const templateId = typeof dto.templateId === 'string'
      ? String(dto.templateId || '').trim() || undefined
      : current.templateId || undefined;
    const updated = await this.prisma.resume.update({
      where: { id },
      data: {
        title: normalized.title,
        contact: attachSkillCategoriesToContact(normalized.contact, categories),
        skills: categories.skills,
        languages: categories.languages,
        summary: normalized.summary,
        experience: normalized.experience,
        education: normalized.education,
        projects: normalized.projects,
        certifications: normalized.certifications,
        templateId,
      },
    });
    return decorateResumeWithSkillCategories(updated);
  }

  async duplicate(userId: string, id: string, title?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await ensureUsagePeriod(this.prisma, user);
    const refreshedUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!refreshedUser) {
      throw new NotFoundException('User not found');
    }
    const normalizedUser = await ensureFreePlanFloors(this.prisma, refreshedUser);
    const paymentFeatureEnabled = await this.isPaymentFeatureEnabled();
    const resumeCount = await this.prisma.resume.count({ where: { userId } });
    if (paymentFeatureEnabled && resumeCount + 1 > normalizedUser.resumesLimit) {
      if (normalizedUser.plan === 'FREE') {
        throw new ForbiddenException('FREE_PLAN_RESUME_LIMIT_EXCEEDED: Free plan allows up to 2 resumes.');
      }
      throw new ForbiddenException('Resume limit exceeded for your plan.');
    }
    const resume = await this.getRaw(userId, id);
    const currentCategories = readSkillCategoriesFromContact(resume.contact);
    const nextTitle = title || `${resume.title} Copy`;
    const normalized = validateResumeSectionsOrThrow({
      title: nextTitle,
      contact: (resume.contact as Record<string, unknown> | undefined) ?? undefined,
      summary: resume.summary,
      skills: Array.isArray(resume.skills) ? resume.skills : [],
      technicalSkills: currentCategories.technicalSkills,
      softSkills: currentCategories.softSkills,
      languages: Array.isArray((resume as any).languages) ? ((resume as any).languages as string[]) : [],
      experience: Array.isArray(resume.experience) ? resume.experience as any[] : [],
      education: Array.isArray(resume.education) ? resume.education as any[] : [],
      projects: Array.isArray(resume.projects) ? resume.projects as any[] : [],
      certifications: Array.isArray(resume.certifications) ? resume.certifications as any[] : [],
    });
    const categories = resolveSkillCategories({
      skills: normalized.skills,
      technicalSkills: normalized.technicalSkills,
      softSkills: normalized.softSkills,
    });
    enforceAtsResumeRules({
      summary: normalized.summary,
      skills: categories.skills,
      experience: normalized.experience,
      education: normalized.education,
    });
    const duplicated = await this.prisma.resume.create({
      data: {
        userId,
        title: normalized.title,
        contact: attachSkillCategoriesToContact(normalized.contact, categories),
        skills: categories.skills,
        languages: categories.languages,
        summary: normalized.summary,
        experience: normalized.experience,
        education: normalized.education,
        projects: normalized.projects ?? [],
        certifications: normalized.certifications ?? [],
        templateId: resume.templateId ?? undefined,
      },
    });
    return decorateResumeWithSkillCategories(duplicated);
  }

  async remove(userId: string, id: string) {
    await this.get(userId, id);
    return this.prisma.resume.delete({ where: { id } });
  }

  async atsScoreForResume(userId: string, id: string, jdText?: string) {
    rateLimitOrThrow({
      key: `resume:ats:${userId}`,
      limit: 20,
      windowMs: 60_000,
      message: 'Rate limit exceeded for ATS scans.',
    });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await ensureUsagePeriod(this.prisma, user);
    const refreshedRaw = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!refreshedRaw) {
      throw new NotFoundException('User not found');
    }
    const refreshed = await ensureFreePlanFloors(this.prisma, refreshedRaw);
    if (!refreshed) {
      throw new NotFoundException('User not found');
    }
    const paymentFeatureEnabled = await this.isPaymentFeatureEnabled();
    if (paymentFeatureEnabled && refreshed.atsScansUsed + 1 > refreshed.atsScansLimit) {
      if (refreshed.plan === 'FREE') {
        throw new ForbiddenException('FREE_PLAN_ATS_LIMIT_EXCEEDED: Free plan allows ATS checks for up to 2 scans.');
      }
      throw new ForbiddenException('ATS scan limit exceeded.');
    }
    const resume = await this.get(userId, id);
    const resumeText = buildResumeText(resume);
    const bulletPointers = collectBulletPointers(resume, id);
    const result = computeAtsScore({
      resumeText,
      jdText: jdText || '',
      skills: resume.skills,
      sections: {
        summary: Boolean(resume.summary?.trim()),
        experience: Array.isArray(resume.experience) && resume.experience.length > 0,
        education: Array.isArray(resume.education) && resume.education.length > 0,
        skills: Array.isArray(resume.skills) && resume.skills.length >= 3,
      },
      bullets: collectBullets(resume),
      experienceCount: Array.isArray(resume.experience) ? resume.experience.length : 0,
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { atsScansUsed: refreshed.atsScansUsed + 1 },
    });
    const issues = buildAtsIssues({
      failedBullets: result.actionVerbRule.failedBullets,
      bulletPointers,
      jdUsed: result.jobDescriptionUsed,
    });
    return {
      resumeId: id,
      ...result,
      issues,
      meta: { jobDescriptionUsed: result.jobDescriptionUsed },
    };
  }

  async generatePdf(userId: string, id: string) {
    rateLimitOrThrow({
      key: `resume:pdf:${userId}`,
      limit: 8,
      windowMs: 60_000,
      message: 'Rate limit exceeded for PDF export.',
    });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const paymentFeatureEnabled = await this.isPaymentFeatureEnabled();
    if (paymentFeatureEnabled && user.plan === 'FREE') {
      throw new ForbiddenException('Free plan does not allow PDF export.');
    }
    await ensureUsagePeriod(this.prisma, user);
    const updatedUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }
    if (paymentFeatureEnabled && updatedUser.pdfExportsUsed + 1 > updatedUser.pdfExportsLimit) {
      throw new ForbiddenException('PDF export limit exceeded');
    }
    const resume = await this.get(userId, id);
    validatePdfExportSafety(resume, { enforceMinimumScore: paymentFeatureEnabled });
    const html = renderResumeHtml(resume);

    await this.prisma.user.update({
      where: { id: userId },
      data: { pdfExportsUsed: updatedUser.pdfExportsUsed + 1 },
    });

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const buffer = await page.pdf({
        format: 'A4',
        printBackground: false,
        margin: { top: '20mm', bottom: '20mm', left: '16mm', right: '16mm' },
      });
      return buffer;
    } finally {
      await browser.close();
    }
  }

  async parseResumeUpload(
    file: { originalname: string; mimetype: string; size?: number; buffer: Buffer },
    options?: { resumeId?: string; title?: string; mode?: 'extract-only' | 'extract-and-map' },
  ) {
    const text = await extractTextFromFile(file);
    const trimmed = String(text || '').trim();
    if (!trimmed || trimmed.length < 10) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[parse-upload] extracted text too short (${trimmed.length} chars) for ${file.originalname}`);
      }
      throw new UnprocessableEntityException({
        errors: [
          {
            path: 'file',
            message: 'No extractable text found. If this is a scanned PDF, upload a text-based PDF or DOCX.',
          },
        ],
      });
    }

    const normalized = normalizeText(trimmed);
    const parsed = parseResumeText(normalized);
    try {
      const dateMatches = collectDateMatches(normalized);
      const mapped = mapParsedResume(parsed);
      const sanitized = sanitizeImportedResume({
        title: options?.title?.trim() || mapped.title,
        contact: mapped.contact,
        summary: mapped.summary,
        skills: mapped.skills,
        experience: mapped.experience,
        education: mapped.education,
        projects: mapped.projects,
        certifications: mapped.certifications,
        unmappedText: mapped.unmappedText,
      }, { mode: 'upload' });
      const finalizedExperience = finalizeExperience({
        experience: sanitized.experience,
        parsed,
        fullText: trimmed,
        dateMatches,
      });
      sanitized.experience = finalizedExperience;
      const parsedPayload = {
        title: sanitized.title,
        contact: sanitized.contact,
        summary: sanitized.summary,
        skills: sanitized.skills,
        experience: sanitized.experience,
        education: sanitized.education,
        projects: sanitized.projects,
        certifications: sanitized.certifications,
        roleLevel: mapped.roleLevel,
        signals: mapped.signals,
        unmappedText: sanitized.unmappedText,
      };
      const debugPayload = {
        experienceSignals: mapped.signals,
        sectionHits: summarizeSectionHits(parsed.sections),
        dateMatches,
      };
      return {
        text: normalized,
        fileName: file.originalname,
        parsed: parsedPayload,
        ...parsedPayload,
        debug: debugPayload,
        mode: options?.mode || 'extract-and-map',
      };
    } catch (error: unknown) {
      const issues = extractValidationIssues(error);
      if (issues.length) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[parse-upload] mapping validation failed: ${issues.map((item) => `${item.path}: ${item.message}`).join(' | ')}`);
        }
        throw new BadRequestException({ errors: issues });
      }
      throw error;
    }
  }

  private async isPaymentFeatureEnabled() {
    if (!this.settingsService) return false;
    return this.settingsService.isPaymentFeatureEnabled();
  }
}

function defaultResumeCreateRateLimitEnabled() {
  if (String(process.env.FORCE_DISABLE_RATE_LIMIT || '').trim().toLowerCase() === 'true') return false;
  const fromEnv = String(process.env.RESUME_CREATION_RATE_LIMIT_DEFAULT || '').trim().toLowerCase();
  if (fromEnv === 'true') return true;
  if (fromEnv === 'false') return false;
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') return false;
  return true;
}

function isHttpExceptionWithStatus(error: unknown, status: number) {
  if (!(error instanceof HttpException)) return false;
  return error.getStatus() === status;
}

function extractValidationIssues(error: unknown) {
  if (!error || typeof error !== 'object') return [];
  const maybeError = error as { issues?: Array<{ path?: unknown; message?: unknown }> };
  if (!Array.isArray(maybeError.issues)) return [];
  return maybeError.issues
    .map((issue) => ({
      path: Array.isArray(issue.path) ? issue.path.join('.') : 'parsed',
      message: typeof issue.message === 'string' ? issue.message : 'Invalid parsed data',
    }));
}

function summarizeSectionHits(sections: Record<string, string[]>) {
  const hits: Record<string, number> = {};
  for (const [key, lines] of Object.entries(sections || {})) {
    const count = Array.isArray(lines) ? lines.filter((line) => String(line || '').trim().length > 0).length : 0;
    if (count > 0) hits[key] = count;
  }
  return hits;
}

function collectDateMatches(text: string, limit = 40) {
  const pattern = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\s*(?:-|to|–|—)\s*(?:present|current|now|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}|\d{4})\b|\b\d{1,2}[/-]\d{4}\s*(?:-|to|–|—)\s*(?:\d{1,2}[/-]\d{4}|present|current|now)\b|\b(?:19|20)\d{2}\s*(?:-|to|–|—)\s*(?:present|current|now|(?:19|20)\d{2})\b/gi;
  const matches = Array.from(String(text || '').matchAll(pattern))
    .map((match) => String(match[0] || '').trim())
    .filter(Boolean);
  return Array.from(new Set(matches)).slice(0, limit);
}

type ExperienceExtractionEntry = {
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  highlights: string[];
};

export function finalizeExperience(input: {
  experience: ExperienceExtractionEntry[];
  parsed: ParsedResumeText;
  fullText: string;
  dateMatches?: string[];
}) {
  const { experience, parsed, fullText, dateMatches } = input;
  const matches = dateMatches ?? collectDateMatches(fullText);
  const lowConfidence = isLowConfidenceExperience(experience, matches);
  if (!lowConfidence) {
    logExperienceFinalizer(false, experience.length, lowConfidence);
    return experience;
  }
  const fallback = extractExperienceFromText(fullText, parsed);
  const cleaned = fallback.map((entry) => ({
    company: cleanExperienceValue(entry.company),
    role: cleanExperienceValue(entry.role),
    startDate: normalizeDateRangeToken(entry.startDate),
    endDate: normalizeDateRangeToken(entry.endDate),
    highlights: uniqueLines(entry.highlights.map((line) => cleanHighlightEntry(line))),
  })).filter((entry) => entry.company || entry.role);
  logExperienceFinalizer(cleaned.length > 0, cleaned.length, lowConfidence);
  return cleaned.length ? cleaned : experience;
}

const EXPERIENCE_SECTION_PATTERN = /(professional\s+experience|work\s+experience|experience)/i;
const STOP_SECTION_PATTERN = /^(skills|education|projects|certifications|achievements|hobbies|languages)\b/i;
const DATE_RANGE_PATTERN = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*\d{4}|\b\d{4}\b)(?:\s*(?:-|to|–|—)\s*(?:present|current|now|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*\d{4}|\b\d{4}\b))?/i;

export function extractExperienceFromText(fullText: string, parsed?: ParsedResumeText) {
  const rawText = String(fullText || '').trim();
  if (!rawText && !(parsed?.lines?.length)) return [];
  const rawLines = rawText
    ? rawText.split(/\r?\n/).map((line) => line.trim())
    : [];
  const lines = rawLines.length ? rawLines : (parsed?.lines || []);
  const startIndex = lines.findIndex((line) => isExperienceSection(line));
  if (startIndex < 0) return [];
  const relevant: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const normalizedHeading = line.toLowerCase().replace(/[:\s]+$/g, '');
    if (STOP_SECTION_PATTERN.test(normalizedHeading) && !/^achievements:?$/i.test(line)) {
      break;
    }
    relevant.push(line);
  }
  if (!relevant.length) return [];
  return parseWorkExperienceEntries(relevant);
}

function isExperienceSection(line: string) {
  if (!line) return false;
  if (EXPERIENCE_SECTION_PATTERN.test(line)) return true;
  return detectHeading(line.toLowerCase()) === 'experience';
}

function isLowConfidenceExperience(entries: ExperienceExtractionEntry[], matches: string[]) {
  if (!entries.length) return true;
  if (entries.length === 1) {
    const entry = entries[0];
    if (isSuspiciousFragment(entry.company) || isSuspiciousFragment(entry.role)) return true;
    const combined = `${entry.company} ${entry.role}`;
    if (/07\)/.test(combined) || /\(-07/.test(combined)) return true;
    if (/\b2008\b/.test(combined) && /[()]/.test(combined)) return true;
  }
  if ((matches?.length ?? 0) >= 3 && entries.length < 2) return true;
  return false;
}

function isSuspiciousFragment(value: string) {
  const cleaned = String(value || '').trim();
  return /^\(?-?\d{2}\)?$/.test(cleaned);
}

function logExperienceFinalizer(fallbackUsed: boolean, fallbackCount: number, lowConfidence: boolean) {
  if (process.env.RESUME_PARSE_DEBUG !== '1') return;
  console.debug(`[parse-upload] experience finalizer lowConfidence=${lowConfidence} fallbackUsed=${fallbackUsed} extracted=${fallbackCount}`);
}

function parseWorkExperienceEntries(lines: string[]) {
  const entries: ExperienceExtractionEntry[] = [];
  let pendingCompany: string | null = null;
  let currentEntry: ExperienceExtractionEntry | null = null;
  let highlightBuffer = '';

  const flushHighlightBuffer = () => {
    if (!currentEntry) {
      highlightBuffer = '';
      return;
    }
    const trimmed = highlightBuffer.trim();
    if (trimmed) {
      currentEntry.highlights.push(trimmed);
    }
    highlightBuffer = '';
  };

  const startEntry = (company: string, role: string, startDate: string, endDate: string) => {
    flushHighlightBuffer();
    const entry: ExperienceExtractionEntry = {
      company,
      role,
      startDate,
      endDate,
      highlights: [],
    };
    entries.push(entry);
    currentEntry = entry;
    pendingCompany = null;
  };

  const appendHighlight = (line: string, nextLine: string) => {
    if (!currentEntry) return;
    const cleaned = cleanHighlightEntry(line);
    if (!cleaned) return;
    const nextTrim = nextLine.trim();
    const nextStartsLower = /^[a-z]/.test(nextTrim);
    const endsWithSentence = /[.?!]$/.test(cleaned);
    const shouldContinue = (!endsWithSentence && nextStartsLower) || cleaned.endsWith(',');
    if (highlightBuffer) {
      highlightBuffer = `${highlightBuffer} ${cleaned}`.trim();
    } else {
      highlightBuffer = cleaned;
    }
    if (!shouldContinue) {
      flushHighlightBuffer();
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) continue;
    if (/^achievements:?$/i.test(line)) continue;
    const nextLine = lines[index + 1]?.trim() ?? '';

    const inline = parseInlineExperienceLine(line);
    if (inline) {
      startEntry(inline.company, inline.role, inline.startDate, inline.endDate);
      continue;
    }

    if (!pendingCompany && isCompanyLineCandidate(line, nextLine)) {
      pendingCompany = line;
      continue;
    }

    if (pendingCompany) {
      const parsed = parseRoleLine(line);
      if (parsed) {
        startEntry(pendingCompany, parsed.role, parsed.startDate, parsed.endDate);
        continue;
      }
      if (isCompanyLineCandidate(line, nextLine)) {
        pendingCompany = line;
        continue;
      }
    }

    if (currentEntry) {
      appendHighlight(line, nextLine);
    }
  }

  flushHighlightBuffer();
  const collapsed = collapseNarrativeCompanies(entries);
  return collapsed
    .map((entry) => ({
      ...entry,
      highlights: uniqueLines(entry.highlights),
    }))
    .filter((entry) => entry.company || entry.role);
}

function parseInlineExperienceLine(line: string) {
  const parsed = parseRoleLine(line);
  if (!parsed || !parsed.role) return null;
  const inlineMatch = parsed.beforeRange?.match(/(.+?)\s+(?:\u2014|\u2013|-|\|)\s+(.+)/);
  if (!inlineMatch) return null;
  return {
    company: inlineMatch[1].trim(),
    role: cleanRoleText(inlineMatch[2].trim()),
    startDate: parsed.startDate,
    endDate: parsed.endDate,
  };
}

function parseRoleLine(line: string) {
  const match = DATE_RANGE_PATTERN.exec(line);
  if (!match) return null;
  const range = match[0];
  const tokens = range.split(/(?:-|to|â€“|â€”)/i).map((token) => token.trim()).filter(Boolean);
  const startRaw = tokens[0] || '';
  const endRaw = tokens.length > 1 ? tokens[tokens.length - 1] : '';
  const beforeRange = line.slice(0, match.index).trim();
  return {
    role: cleanRoleText(beforeRange),
    startDate: startRaw,
    endDate: endRaw,
    beforeRange,
    rawLine: line,
  };
}

function hasDateRange(line: string) {
  return Boolean(DATE_RANGE_PATTERN.test(line));
}

const COMPANY_KEYWORD_PATTERN = /(inc|llc|ltd|corp|company|technologies|systems|solutions|group|partners|bank|consulting|enterprises|services|labs|digital|pvt|limited|infotech)/i;
const NARRATIVE_VERB_PATTERN = /\b(?:owned|responsible|led|worked|developed|designed|implemented|collaborated|architected|delivered|mentored)\b/i;

function collapseNarrativeCompanies(entries: ExperienceExtractionEntry[]) {
  const output: ExperienceExtractionEntry[] = [];
  for (const entry of entries) {
    const companyText = String(entry.company || '').trim();
    if (NARRATIVE_VERB_PATTERN.test(companyText)) {
      if (!output.length) continue;
      const previous = output[output.length - 1];
      previous.highlights.unshift(companyText);
      previous.highlights.push(...entry.highlights);
      continue;
    }
    output.push({ ...entry, highlights: [...entry.highlights] });
  }
  return output;
}

function isCompanyLineCandidate(line: string, nextLine?: string) {
  if (!line) return false;
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return false;
  if (/^\(?-?\d{1,4}\)?$/.test(trimmed)) return false;
  if (/^[-•*]/.test(trimmed)) return false;
  if (trimmed.includes(':') && !/^achievements:?$/i.test(trimmed)) return false;
  if (trimmed.includes('. ') || trimmed.endsWith('.')) return false;
  if (/^as\s+/i.test(trimmed)) return false;
  if (isSectionHeadingLine(trimmed)) return false;
  if (containsDateToken(trimmed)) return false;
  if (containsNarrativeVerb(trimmed)) return false;
  if (nextLine && hasDateRange(nextLine)) return true;
  if (COMPANY_KEYWORD_PATTERN.test(trimmed)) return true;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2 && tokens.every((word) => /^[A-Z0-9]/.test(word))) return true;
  return false;
}

function containsDateToken(line: string) {
  return /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|present|current|now|\d{4})\b/i.test(line);
}

function containsNarrativeVerb(line: string) {
  return NARRATIVE_VERB_PATTERN.test(line);
}

function isSectionHeadingLine(line: string) {
  const normalized = line.toLowerCase().replace(/[:\s]+$/g, '');
  if (!normalized) return false;
  if (STOP_SECTION_PATTERN.test(normalized)) return true;
  return Boolean(detectHeading(line));
}

function cleanExperienceValue(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanRoleText(value: string) {
  const trimmed = String(value || '').replace(/\s+/g, ' ').trim();
  return trimmed.replace(/\s*\([^)]*\)\s*$/g, '').trim();
}

function normalizeDateRangeToken(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/present|current|now/i.test(raw)) return 'Present';
  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
  };
  const monthYear = raw.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{4})$/i);
  if (monthYear) {
    const month = monthMap[monthYear[1].slice(0, 4).toLowerCase()] || monthMap[monthYear[1].slice(0, 3).toLowerCase()];
    return month ? `${monthYear[2]}-${month}` : `${monthYear[2]}`;
  }
  const mmYyyy = raw.match(/^(\d{1,2})[/-](\d{4})$/);
  if (mmYyyy) {
    const month = Number(mmYyyy[1]);
    if (!Number.isNaN(month) && month >= 1 && month <= 12) {
      return `${mmYyyy[2]}-${String(month).padStart(2, '0')}`;
    }
  }
  const yyyyMm = raw.match(/^(\d{4})[/-](\d{1,2})$/);
  if (yyyyMm) {
    const month = Number(yyyyMm[2]);
    if (!Number.isNaN(month) && month >= 1 && month <= 12) {
      return `${yyyyMm[1]}-${String(month).padStart(2, '0')}`;
    }
  }
  const yearOnly = raw.match(/^(\d{4})$/);
  if (yearOnly) {
    return yearOnly[1];
  }
  return raw;
}

function cleanHighlightEntry(line: string) {
  return line.replace(/^[-*]\s*/, '').trim();
}

function validateResumeSectionsOrThrow(input: {
  title: string;
  contact?: Record<string, unknown>;
  summary: string;
  skills: string[];
  technicalSkills?: string[];
  softSkills?: string[];
  languages?: string[];
  experience: any[];
  education: any[];
  projects?: any[];
  certifications?: any[];
}) {
  const parsed = ResumeSectionsSchema.safeParse({
    title: input.title,
    contact: input.contact,
    summary: input.summary,
    skills: input.skills,
    technicalSkills: input.technicalSkills ?? [],
    softSkills: input.softSkills ?? [],
    languages: input.languages ?? [],
    experience: input.experience,
    education: input.education,
    projects: input.projects ?? [],
    certifications: input.certifications ?? [],
  });
  if (!parsed.success) {
    throw new BadRequestException({
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'resume',
        message: issue.message,
      })),
    });
  }
  return normalizeResumeDatesOrThrow(parsed.data);
}

function normalizeResumeDatesOrThrow(input: any) {
  const errors: Array<{ path: string; message: string }> = [];
  const normalizedExperience = (Array.isArray(input.experience) ? input.experience : []).map((item: any, index: number) => {
    const startDate = normalizePersistDateToken(item.startDate, {
      allowPresent: false,
      required: true,
      path: `experience.${index}.startDate`,
      errors,
    });
    const endDate = normalizePersistDateToken(item.endDate, {
      allowPresent: true,
      required: true,
      path: `experience.${index}.endDate`,
      errors,
    });
    if (isYearMonth(startDate) && isYearMonth(endDate) && compareMonthTokens(endDate, startDate) < 0) {
      errors.push({
        path: `experience.${index}.endDate`,
        message: 'End date must be on or after start date.',
      });
    }
    return { ...item, startDate, endDate };
  });
  const normalizedEducation = (Array.isArray(input.education) ? input.education : []).map((item: any, index: number) => {
    const startDate = normalizePersistDateToken(item.startDate, {
      allowPresent: false,
      required: true,
      path: `education.${index}.startDate`,
      errors,
    });
    const endDate = normalizePersistDateToken(item.endDate, {
      allowPresent: false,
      required: true,
      path: `education.${index}.endDate`,
      errors,
    });
    if (isYearMonth(startDate) && isYearMonth(endDate) && compareMonthTokens(endDate, startDate) < 0) {
      errors.push({
        path: `education.${index}.endDate`,
        message: 'End date must be on or after start date.',
      });
    }
    return { ...item, startDate, endDate };
  });
  const normalizedProjects = (Array.isArray(input.projects) ? input.projects : []).map((item: any, index: number) => {
    const startDate = normalizePersistDateToken(item.startDate, {
      allowPresent: false,
      required: false,
      path: `projects.${index}.startDate`,
      errors,
    });
    const endDate = normalizePersistDateToken(item.endDate, {
      allowPresent: false,
      required: false,
      path: `projects.${index}.endDate`,
      errors,
    });
    if (isYearMonth(startDate) && isYearMonth(endDate) && compareMonthTokens(endDate, startDate) < 0) {
      errors.push({
        path: `projects.${index}.endDate`,
        message: 'End date must be on or after start date.',
      });
    }
    return {
      ...item,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };
  });
  const normalizedCertifications = (Array.isArray(input.certifications) ? input.certifications : []).map((item: any, index: number) => {
    const date = normalizePersistDateToken(item.date, {
      allowPresent: false,
      required: false,
      path: `certifications.${index}.date`,
      errors,
    });
    return {
      ...item,
      date: date || undefined,
    };
  });

  if (errors.length) {
    throw new BadRequestException({ errors });
  }

  return {
    ...input,
    experience: normalizedExperience,
    education: normalizedEducation,
    projects: normalizedProjects,
    certifications: normalizedCertifications,
  };
}

function normalizePersistDateToken(
  rawValue: string,
  options: {
    allowPresent: boolean;
    required: boolean;
    path: string;
    errors: Array<{ path: string; message: string }>;
  },
) {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    if (options.required) {
      options.errors.push({
        path: options.path,
        message: options.allowPresent
          ? 'Date is required. Use YYYY-MM or Present.'
          : 'Date is required. Use YYYY-MM.',
      });
    }
    return '';
  }

  if (options.allowPresent && /^(present|current|now)$/i.test(raw)) {
    return 'Present';
  }

  const normalized = toYearMonthToken(raw);
  if (!normalized) {
    options.errors.push({
      path: options.path,
      message: options.allowPresent
        ? 'Invalid date. Use YYYY-MM or Present.'
        : 'Invalid date. Use YYYY-MM.',
    });
    return raw;
  }
  return normalized;
}

function toYearMonthToken(value: string) {
  const clean = String(value || '').trim().toLowerCase();
  if (!clean) return '';

  const direct = clean.match(/^(19\d{2}|20\d{2})-(0[1-9]|1[0-2])$/);
  if (direct) return `${direct[1]}-${direct[2]}`;

  const monthMap: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    sept: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };

  const monthYear = clean.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(19\d{2}|20\d{2})$/i);
  if (monthYear) {
    const month = monthMap[monthYear[1].toLowerCase().slice(0, 4)] || monthMap[monthYear[1].toLowerCase().slice(0, 3)];
    if (!month) return '';
    return `${monthYear[2]}-${month}`;
  }

  const mmYyyy = clean.match(/^(\d{1,2})[/-](19\d{2}|20\d{2})$/);
  if (mmYyyy) {
    const monthNumber = Number(mmYyyy[1]);
    if (Number.isNaN(monthNumber) || monthNumber < 1 || monthNumber > 12) return '';
    const month = monthNumber;
    return `${mmYyyy[2]}-${String(month).padStart(2, '0')}`;
  }

  const yyyyMm = clean.match(/^(19\d{2}|20\d{2})[/-](\d{1,2})$/);
  if (yyyyMm) {
    const monthNumber = Number(yyyyMm[2]);
    if (Number.isNaN(monthNumber) || monthNumber < 1 || monthNumber > 12) return '';
    const month = monthNumber;
    return `${yyyyMm[1]}-${String(month).padStart(2, '0')}`;
  }

  const yyyyOnly = clean.match(/^(19\d{2}|20\d{2})$/);
  if (yyyyOnly) {
    return `${yyyyOnly[1]}-01`;
  }

  return '';
}

function isYearMonth(value: string) {
  return /^(19\d{2}|20\d{2})-(0[1-9]|1[0-2])$/.test(String(value || ''));
}

function compareMonthTokens(a: string, b: string) {
  if (!isYearMonth(a) || !isYearMonth(b)) return 0;
  const [aYear, aMonth] = a.split('-').map((item) => Number(item));
  const [bYear, bMonth] = b.split('-').map((item) => Number(item));
  const aIndex = aYear * 12 + (aMonth - 1);
  const bIndex = bYear * 12 + (bMonth - 1);
  if (aIndex === bIndex) return 0;
  return aIndex > bIndex ? 1 : -1;
}

function resolveSkillCategories(input: {
  skills?: string[];
  technicalSkills?: string[];
  softSkills?: string[];
  languages?: string[];
}) {
  const technicalSkills = dedupeSkills(input.technicalSkills || []);
  const softSkills = dedupeSkills(input.softSkills || []);
  const legacySkills = dedupeSkills(input.skills || []);
  const explicitLanguages = dedupeLanguages(input.languages || []);

  const technicalBase = technicalSkills.length ? technicalSkills : legacySkills;
  const extractedFromTechnical = technicalBase.filter((skill) => isSpokenLanguageSkill(skill)).map((skill) => normalizeLanguageTag(skill));
  const extractedFromLegacy = legacySkills.filter((skill) => isSpokenLanguageSkill(skill)).map((skill) => normalizeLanguageTag(skill));
  const languages = dedupeLanguages([...explicitLanguages, ...extractedFromTechnical, ...extractedFromLegacy]);

  const technical = technicalBase.filter((skill) => !isSpokenLanguageSkill(skill));
  const soft = softSkills;
  const legacyWithoutLanguages = legacySkills.filter((skill) => !isSpokenLanguageSkill(skill));
  const merged = dedupeSkills([...technical, ...soft, ...legacyWithoutLanguages]);

  return {
    skills: merged,
    technicalSkills: technical,
    softSkills: soft,
    languages,
  };
}

function dedupeSkills(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values || []) {
    const clean = String(value || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

function dedupeLanguages(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values || []) {
    const normalized = normalizeLanguageTag(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function normalizeLanguageTag(value: string) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  const normalized = clean.toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [token, canonical] of KNOWN_SPOKEN_LANGUAGES.entries()) {
    const regex = new RegExp(`^${token}(?:\\b|\\s|-)`, 'i');
    if (regex.test(normalized)) {
      return canonical;
    }
  }
  return clean;
}

function isSpokenLanguageSkill(value: string) {
  const normalized = normalizeLanguageTag(value);
  if (!normalized) return false;
  return KNOWN_SPOKEN_LANGUAGES.has(normalized.toLowerCase());
}

async function ensureFreePlanFloors(
  prisma: PrismaService,
  user: {
    id: string;
    plan: string;
    resumesLimit: number;
    atsScansLimit: number;
    atsScansUsed: number;
    [key: string]: unknown;
  },
) {
  if (user.plan !== 'FREE') {
    return user;
  }
  const nextResumesLimit = Math.max(Number(user.resumesLimit || 0), FREE_PLAN_RESUME_LIMIT);
  const nextAtsLimit = Math.max(Number(user.atsScansLimit || 0), FREE_PLAN_ATS_LIMIT);
  if (nextResumesLimit === user.resumesLimit && nextAtsLimit === user.atsScansLimit) {
    return user;
  }
  return prisma.user.update({
    where: { id: user.id },
    data: {
      resumesLimit: nextResumesLimit,
      atsScansLimit: nextAtsLimit,
    },
  });
}

function attachSkillCategoriesToContact(
  contact: Record<string, unknown> | undefined,
  categories: { technicalSkills: string[]; softSkills: string[] },
) {
  if (!contact) return undefined;
  const next: Record<string, unknown> = { ...contact };
  next.skillCategories = {
    technicalSkills: categories.technicalSkills,
    softSkills: categories.softSkills,
  };
  return next as Prisma.InputJsonValue;
}

function readSkillCategoriesFromContact(contact: unknown) {
  if (!contact || typeof contact !== 'object' || Array.isArray(contact)) {
    return { technicalSkills: [] as string[], softSkills: [] as string[] };
  }
  const maybeCategories = (contact as Record<string, unknown>).skillCategories;
  if (!maybeCategories || typeof maybeCategories !== 'object' || Array.isArray(maybeCategories)) {
    return { technicalSkills: [] as string[], softSkills: [] as string[] };
  }
  const technicalSkills = Array.isArray((maybeCategories as Record<string, unknown>).technicalSkills)
    ? dedupeSkills((maybeCategories as Record<string, unknown>).technicalSkills as string[])
    : [];
  const softSkills = Array.isArray((maybeCategories as Record<string, unknown>).softSkills)
    ? dedupeSkills((maybeCategories as Record<string, unknown>).softSkills as string[])
    : [];
  return { technicalSkills, softSkills };
}

function cleanContactForResponse(contact: unknown) {
  if (!contact || typeof contact !== 'object' || Array.isArray(contact)) return undefined;
  const obj = contact as Record<string, unknown>;
  const fullName = typeof obj.fullName === 'string' ? obj.fullName : '';
  const email = typeof obj.email === 'string' ? obj.email : undefined;
  const phone = typeof obj.phone === 'string' ? obj.phone : undefined;
  const location = typeof obj.location === 'string' ? obj.location : undefined;
  const links = Array.isArray(obj.links)
    ? obj.links.map((item) => String(item || '').trim()).filter(Boolean)
    : undefined;
  if (!fullName && !email && !phone && !location && !links?.length) return undefined;
  return {
    fullName,
    email,
    phone,
    location,
    links: links?.length ? links : undefined,
  };
}

function decorateResumeWithSkillCategories(resume: any) {
  const categories = readSkillCategoriesFromContact(resume?.contact);
  const fallbackSkills = Array.isArray(resume?.skills) ? dedupeSkills(resume.skills) : [];
  const normalized = resolveSkillCategories({
    skills: fallbackSkills,
    technicalSkills: categories.technicalSkills.length ? categories.technicalSkills : fallbackSkills,
    softSkills: categories.softSkills,
    languages: Array.isArray(resume?.languages) ? (resume.languages as string[]) : [],
  });
  return {
    ...resume,
    contact: cleanContactForResponse(resume?.contact),
    skills: normalized.skills,
    technicalSkills: normalized.technicalSkills,
    softSkills: normalized.softSkills,
    languages: normalized.languages,
  };
}

function enforceAtsResumeRules(input: {
  summary: string;
  skills: string[];
  experience: Array<{ highlights?: string[] }>;
  education: Array<{ details?: string[] }>;
}) {
  const errors: string[] = [];
  const fields: Array<{ path: string; message: string; suggestions?: string[] }> = [];
  let primaryCode = 'RESUME_VALIDATION_ERROR';
  if (!input.summary || input.summary.trim().length < 20) {
    errors.push('Summary is required and must be at least 20 characters.');
  }
  if (!Array.isArray(input.skills) || input.skills.length < 3) {
    errors.push('Skills section must include at least 3 skills.');
  }
  if (!Array.isArray(input.experience) || input.experience.length < 1) {
    errors.push('Experience section is required.');
  }
  if (!Array.isArray(input.education) || input.education.length < 1) {
    errors.push('Education section is required.');
  }

  const indexedBullets = input.experience.flatMap((e, expIndex) => {
    const lines = Array.isArray(e.highlights) ? e.highlights : [];
    return lines.map((line, highlightIndex) => ({
      expIndex,
      highlightIndex,
      text: String(line || '').trim(),
    }));
  }).filter((entry) => entry.text.length > 0);
  const normalized = indexedBullets.map((entry) => entry.text);
  if (normalized.length === 0) {
    errors.push('Experience must include at least one bullet highlight.');
  }
  const tooLong = normalized.filter((b) => wordCount(b) > 28);
  if (tooLong.length > 0) {
    errors.push('Experience bullets must be 28 words or fewer.');
  }
  const actionVerbRule = analyzeActionVerbRule(normalized, ACTION_VERB_REQUIRED_RATIO);
  if (!actionVerbRule.passes) {
    primaryCode = 'ATS_ACTION_VERB_RATIO';
    errors.push(actionVerbRule.message);
    for (const failing of actionVerbRule.failingBullets) {
      const entry = indexedBullets[failing.index];
      if (!entry) continue;
      fields.push({
        path: `experience[${entry.expIndex}].highlights[${entry.highlightIndex}]`,
        message: failing.reason === 'weak_starter'
          ? 'Replace weak starters (e.g., "Responsible for") with a strong action verb.'
          : 'Start this bullet with a strong action verb.',
        suggestions: failing.suggestions,
      });
    }
  }
  const hasMeasurable = normalized.some((b) => /\d/.test(b));
  if (!hasMeasurable) {
    errors.push('Add at least one measurable outcome (numbers, percentages, or metrics).');
  }

  if (errors.length) {
    throw new UnprocessableEntityException({
      code: primaryCode,
      message: errors[0],
      errors,
      fields,
    });
  }
}

async function extractTextFromFile(file: { originalname: string; mimetype: string; size?: number; buffer: Buffer }) {
  const ext = (file.originalname.split('.').pop() || '').toLowerCase();
  if (file.mimetype === 'application/pdf' || ext === 'pdf') {
    return extractPdfText(file.buffer);
  }
  if (
    file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return extractDocxText(file.buffer);
  }
  if (file.mimetype === 'text/plain' || ext === 'txt') {
    return file.buffer.toString('utf8');
  }
  throw new BadRequestException({
    errors: [`unsupported mimetype: ${file.mimetype || 'unknown'}; allowed types are PDF, DOCX, TXT.`],
  });
}

async function extractPdfText(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return parsed.text || '';
  } catch {
    throw new BadRequestException({
      errors: ['Unable to extract readable text from PDF. Please upload a text-based PDF or DOCX.'],
    });
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer: Buffer) {
  try {
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value || '';
  } catch {
    throw new BadRequestException({
      errors: ['Unable to extract readable text from DOCX.'],
    });
  }
}

function normalizeText(text: string) {
  return text
    .replace(/\u0000/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[•◦▪●]/g, '- ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function mapResumeSections(text: string) {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const sections: Record<string, string[]> = {};
  let currentSection = 'unmapped';

  for (const line of lines) {
    const heading = detectHeading(line.toLowerCase());
    if (heading) {
      currentSection = heading;
      if (!sections[currentSection]) sections[currentSection] = [];
      continue;
    }
    if (!sections[currentSection]) sections[currentSection] = [];
    sections[currentSection].push(line);
  }

  const summaryLines = [
    ...(sections.summary || []),
    ...(sections.profile || []),
    ...(sections.objective || []),
  ];
  const summarySource = summaryLines.length
    ? summaryLines
    : buildFallbackSummaryLines(sections.unmapped || lines);
  const summary = summarySource.join(' ').slice(0, 400).trim();

  const skills = extractSkills([
    ...(sections.skills || []),
    ...(sections.core || []),
    ...(sections.technical || []),
    ...(sections.technologies || []),
  ]);

  const explicitExperienceLines = [
    ...(sections.experience || []),
    ...(sections.employment || []),
    ...(sections.work || []),
    ...(sections.career || []),
  ];
  const experienceLines = explicitExperienceLines.length
    ? explicitExperienceLines
    : collectLikelyExperienceLines(sections.unmapped || []);
  const experience = sortExperienceChronological(
    mergeExperienceByCompany(extractExperience(experienceLines)),
  );

  const education = extractEducation([
    ...(sections.education || []),
    ...(sections.academics || []),
  ]);
  const projects = extractProjects([
    ...(sections.projects || []),
    ...(sections.research || []),
  ]);
  const certifications = extractCertifications([
    ...(sections.certifications || []),
    ...(sections.licenses || []),
  ]);

  const mappedKeys = new Set([
    'summary', 'profile', 'objective',
    'skills', 'core', 'technical', 'technologies',
    'experience', 'employment', 'work', 'career',
    'projects', 'research',
    'education', 'academics',
    'certifications', 'licenses',
  ]);

  const remainingLines = Object.entries(sections)
    .filter(([key]) => !mappedKeys.has(key))
    .flatMap(([, value]) => value);

  const contact = extractContact(lines);
  const resumeText = [
    summary,
    skills.join(' '),
    experience.map((exp) => `${exp.role} ${exp.company} ${exp.highlights.join(' ')}`).join(' '),
  ].join(' ');
  const roleLevel = detectExperienceLevelFromBlocks({
    resumeText,
    experience,
  });

  return {
    title: guessTitle(lines),
    contact,
    summary,
    skills,
    experience,
    education,
    projects,
    certifications,
    roleLevel,
    unmappedText: remainingLines.join('\n').trim() || undefined,
  };
}

function detectHeading(line: string) {
  const normalized = line.replace(/[:\s]+$/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (/^(professional )?summary$|^profile$|^about( me)?$|^objective$|^career summary$/.test(normalized)) return 'summary';
  if (/^skills?$|^core skills$|^key skills$|^technical skills$|^core competencies$|^competencies$|^technologies$/.test(normalized)) return 'skills';
  if (/^experience$|^work history$|^work experience$|^employment history$|^employment$|^professional experience$|^career history$/.test(normalized)) return 'experience';
  if (/^education$|^academic(s)?$|^education history$/.test(normalized)) return 'education';
  if (/^projects?$|^notable projects$|^research$/.test(normalized)) return 'projects';
  if (/^certifications?$|^licenses?$|^certificates$/.test(normalized)) return 'certifications';
  return line.endsWith(':') ? normalized : '';
}

function guessTitle(lines: string[]) {
  const candidate = lines.find((l) => l.length < 60 && !/\d{4}/.test(l) && !/@/.test(l)) || '';
  return candidate || 'Resume';
}

function buildFallbackSummaryLines(lines: string[]) {
  const fallback = lines.filter((line) => !isDateLine(line) && !looksLikeExperienceHeader(line)).slice(0, 2);
  return fallback.length ? fallback : lines.slice(0, 2);
}

function collectLikelyExperienceLines(lines: string[]) {
  const output: string[] = [];
  for (const line of lines) {
    if (looksLikeExperienceHeader(line) || line.startsWith('-') || isDateLine(line)) {
      output.push(line);
      continue;
    }
    if (output.length && line.length > 8) {
      output.push(line);
    }
  }
  return output;
}

function extractSkills(lines: string[]) {
  const tokens = lines
    .flatMap((line) => line.replace(/^skills?:?/i, '').split(/,|;|\||\/|·|•/))
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && token.length < 40);
  return Array.from(new Set(tokens)).slice(0, 20);
}

function extractExperience(lines: string[]) {
  const blocks: Array<{ company: string; role: string; startDate: string; endDate: string; highlights: string[] }> = [];
  let current: { company: string; role: string; startDate: string; endDate: string; highlights: string[] } | null = null;

  for (const line of lines) {
    if (looksLikeExperienceHeader(line)) {
      if (current && hasMeaningfulExperience(current)) blocks.push(current);
      current = buildExperienceHeader(line);
      continue;
    }

    if (!current) {
      current = { company: '', role: '', startDate: '', endDate: '', highlights: [] };
    }

    if (isDateLine(line) && (!current.startDate && !current.endDate)) {
      const dates = extractDates(line);
      current.startDate = dates.start || current.startDate;
      current.endDate = dates.end || current.endDate;
      continue;
    }

    if (line.startsWith('-')) {
      current.highlights.push(line.replace(/^[-*]\s*/, ''));
    } else if (line.length > 10) {
      current.highlights.push(line);
    }
  }

  if (current && hasMeaningfulExperience(current)) blocks.push(current);
  return blocks;
}

function mergeExperienceByCompany(experience: Array<{ company: string; role: string; startDate: string; endDate: string; highlights: string[] }>) {
  const map = new Map<string, { company: string; role: string; startDate: string; endDate: string; highlights: string[] }>();
  for (const item of experience) {
    if (!hasMeaningfulExperience(item)) continue;
    const key = normalizeCompanyKey(item.company) || `${item.role.toLowerCase()}|${item.startDate}|${item.endDate}`;
    if (!map.has(key)) {
      map.set(key, {
        company: item.company.trim(),
        role: item.role.trim(),
        startDate: item.startDate,
        endDate: item.endDate,
        highlights: uniqueLines(item.highlights),
      });
      continue;
    }
    const current = map.get(key)!;
    current.role = pickPreferredRole(current.role, item.role);
    current.startDate = pickEarlierDate(current.startDate, item.startDate);
    current.endDate = pickLaterEndDate(current.endDate, item.endDate);
    current.highlights = uniqueLines([...current.highlights, ...item.highlights]);
  }
  return Array.from(map.values());
}

function sortExperienceChronological(experience: Array<{ company: string; role: string; startDate: string; endDate: string; highlights: string[] }>) {
  const sorted = [...experience];
  sorted.sort((a, b) => {
    const endA = dateToSortValue(a.endDate || a.startDate, true);
    const endB = dateToSortValue(b.endDate || b.startDate, true);
    if (endB !== endA) return endB - endA;
    const startA = dateToSortValue(a.startDate, false);
    const startB = dateToSortValue(b.startDate, false);
    return startB - startA;
  });
  return sorted;
}

function extractEducation(lines: string[]) {
  const blocks: Array<{ institution: string; degree: string; startDate: string; endDate: string; details: string[] }> = [];
  let current: { institution: string; degree: string; startDate: string; endDate: string; details: string[] } | null = null;
  for (const line of lines) {
    if (/(university|college|school|institute|bachelor|master|phd|b\.s|m\.s)/i.test(line)) {
      if (current && (current.institution || current.degree)) blocks.push(current);
      const dates = extractDates(line);
      current = { institution: line, degree: line, startDate: dates.start, endDate: dates.end, details: [] };
      continue;
    }
    if (!current) {
      current = { institution: '', degree: '', startDate: '', endDate: '', details: [] };
    }
    if (line.startsWith('-')) current.details.push(line.replace(/^[-*]\s*/, ''));
  }
  if (current && (current.institution || current.degree)) blocks.push(current);
  return blocks;
}

function extractProjects(lines: string[]) {
  const projects: Array<{ name: string; role?: string; startDate?: string; endDate?: string; highlights: string[] }> = [];
  let current: { name: string; role?: string; startDate?: string; endDate?: string; highlights: string[] } | null = null;
  for (const line of lines) {
    if (looksLikeProjectTitle(line) || isDateLine(line)) {
      if (current && current.highlights.length) projects.push(current);
      const { start, end } = extractDates(line);
      current = { name: stripDates(line), role: '', startDate: start, endDate: end, highlights: [] };
      continue;
    }
    if (!current) current = { name: 'Project', role: '', startDate: '', endDate: '', highlights: [] };
    if (line.startsWith('-')) current.highlights.push(line.replace(/^[-*]\s*/, ''));
    else if (line.length > 10) current.highlights.push(line);
  }
  if (current && current.highlights.length) projects.push(current);
  return projects;
}

function extractCertifications(lines: string[]) {
  const items: Array<{ name: string; issuer?: string; date?: string; details?: string[] }> = [];
  for (const line of lines) {
    if (!line) continue;
    const dateMatch = line.match(/\b(20\d{2}|19\d{2})\b/);
    const date = dateMatch ? dateMatch[1] : '';
    const cleaned = line.replace(/[()]/g, '').replace(/\b(20\d{2}|19\d{2})\b/g, '').trim();
    if (cleaned.length < 2) continue;
    items.push({ name: cleaned, issuer: '', date: date || undefined, details: [] });
  }
  return items;
}

function looksLikeProjectTitle(line: string) {
  return /project|capstone|thesis|research/i.test(line);
}

function stripDates(line: string) {
  return line
    .replace(/\b(20\d{2}|19\d{2})\b/g, '')
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, '')
    .replace(/[-–]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractContact(lines: string[]) {
  const top = lines.slice(0, 6);
  const candidate = top.find((l) => l.length < 60 && !/@/.test(l) && !/\d{4}/.test(l)) || '';
  const emailMatch = lines.join(' ').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = lines.join(' ').match(/\+?\d[\d\s().-]{7,}/);
  const locationMatch = lines.find((l) => /\b(city|state|remote|usa|united states|india|canada|uk)\b/i.test(l));
  const links = lines.filter((l) => /linkedin\.com|github\.com|portfolio|website/i.test(l));
  if (!candidate && !emailMatch && !phoneMatch) return undefined;
  return {
    fullName: candidate || 'Your Name',
    email: emailMatch ? emailMatch[0] : undefined,
    phone: phoneMatch ? phoneMatch[0] : undefined,
    location: locationMatch,
    links: links.length ? links.slice(0, 3) : undefined,
  };
}

function isDateLine(line: string) {
  return /(\b(20\d{2}|19\d{2})\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b)/i.test(line)
    && /-|to|–/.test(line);
}

function extractDates(line: string) {
  const match = line.match(/((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}|\b(?:19|20)\d{2}\b)\s*(?:-|to|–)\s*((?:present|current|now)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}|\b(?:19|20)\d{2}\b)?/i);
  if (!match) return { start: '', end: '' };
  const start = normalizeDateToken(match[1]);
  const end = normalizeDateToken(match[2] || '');
  return { start, end };
}

function looksLikeRoleCompany(line: string) {
  return /\b(engineer|developer|manager|designer|analyst|intern|lead|architect|specialist|consultant|director|head|officer)\b/i.test(line);
}

function looksLikeExperienceHeader(line: string) {
  if (!line || line.startsWith('-')) return false;
  if (detectHeading(line.toLowerCase())) return false;
  const hasDate = isDateLine(line);
  const hasRole = looksLikeRoleCompany(line);
  const hasCompany = looksLikeCompany(line);
  const hasDelimiter = /@| at | \| | - | — /i.test(line);
  return (hasDate && (hasRole || hasCompany || hasDelimiter)) || (hasRole && (hasCompany || hasDelimiter));
}

function buildExperienceHeader(line: string) {
  const dates = extractDates(line);
  const withoutDates = stripDates(line);
  const { role, company } = splitRoleCompany(withoutDates);
  return {
    company: company.trim(),
    role: role.trim(),
    startDate: dates.start,
    endDate: dates.end,
    highlights: [] as string[],
  };
}

function splitRoleCompany(line: string) {
  const raw = line.replace(/\s{2,}/g, ' ').trim();
  if (!raw) return { role: '', company: '' };
  if (raw.includes('@')) {
    const parts = raw.split('@');
    if (parts.length === 2) return { role: parts[0].trim(), company: parts[1].trim() };
  }
  if (/\sat\s/i.test(raw)) {
    const parts = raw.split(/\sat\s/i);
    if (parts.length === 2) return { role: parts[0].trim(), company: parts[1].trim() };
  }
  for (const delimiter of [' — ', ' - ', ' | ']) {
    if (raw.includes(delimiter)) {
      const parts = raw.split(delimiter);
      if (parts.length >= 2) return { role: parts[0].trim(), company: parts.slice(1).join(delimiter).trim() };
    }
  }
  if (looksLikeCompany(raw)) return { role: '', company: raw };
  return { role: raw, company: '' };
}

function looksLikeCompany(line: string) {
  return /(inc|llc|ltd|corp|company|technologies|systems|labs|solutions|group|studio|partners)\b/i.test(line);
}

function normalizeDateToken(token: string) {
  if (!token) return '';
  const cleaned = token.replace(/\u2013|\u2014/g, '-').trim();
  if (/present|current|now/i.test(cleaned)) return 'Present';
  return cleaned;
}

function hasMeaningfulExperience(item: { company: string; role: string; startDate: string; endDate: string; highlights: string[] }) {
  const hasCore = Boolean(item.company.trim() || item.role.trim());
  const hasBullets = item.highlights.some((h) => h.trim().length > 0);
  const hasDates = Boolean(item.startDate || item.endDate);
  return hasCore || hasBullets || hasDates;
}

function normalizeCompanyKey(company: string) {
  return company.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function uniqueLines(lines: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function pickPreferredRole(currentRole: string, nextRole: string) {
  if (!currentRole.trim()) return nextRole.trim();
  if (!nextRole.trim()) return currentRole.trim();
  return currentRole.length >= nextRole.length ? currentRole.trim() : nextRole.trim();
}

function pickEarlierDate(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  return dateToSortValue(a, false) <= dateToSortValue(b, false) ? a : b;
}

function pickLaterEndDate(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  if (/present/i.test(a)) return a;
  if (/present/i.test(b)) return b;
  return dateToSortValue(a, true) >= dateToSortValue(b, true) ? a : b;
}

function dateToSortValue(token: string, end = false) {
  const parsed = parseDateToken(token, end);
  if (!parsed) return 0;
  return parsed.year * 100 + parsed.month;
}

function parseDateToken(token: string, end = false) {
  if (!token) return null;
  if (/present|current|now/i.test(token)) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  const clean = token.trim().toLowerCase();
  const monthMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };
  const monthYear = clean.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{4})/i);
  if (monthYear) {
    const month = monthMap[monthYear[1].slice(0, 4)] || monthMap[monthYear[1].slice(0, 3)] || 1;
    return { year: Number(monthYear[2]), month };
  }
  const yearMonth = clean.match(/(\d{4})[-/](\d{1,2})/);
  if (yearMonth) {
    return { year: Number(yearMonth[1]), month: Math.max(1, Math.min(12, Number(yearMonth[2]))) };
  }
  const yearOnly = clean.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearOnly) {
    return { year: Number(yearOnly[1]), month: end ? 12 : 1 };
  }
  return null;
}

function estimateTotalExperienceMonths(experience: Array<{ company: string; role: string; startDate: string; endDate: string; highlights: string[] }>) {
  let total = 0;
  for (const item of experience) {
    const start = parseDateToken(item.startDate, false);
    if (!start) continue;
    const end = parseDateToken(item.endDate, true) || start;
    const startIndex = start.year * 12 + (start.month - 1);
    const endIndex = end.year * 12 + (end.month - 1);
    total += Math.max(1, endIndex - startIndex + 1);
  }
  return total;
}

function detectExperienceLevelFromBlocks(input: {
  resumeText: string;
  experience: Array<{ company: string; role: string; startDate: string; endDate: string; highlights: string[] }>;
}) {
  const meaningful = input.experience.filter((item) => hasMeaningfulExperience(item));
  const roleCount = meaningful.length;
  const distinctCompanies = new Set(meaningful.map((item) => normalizeCompanyKey(item.company)).filter(Boolean)).size;
  const rolesWithDate = meaningful.filter((item) => parseDateToken(item.startDate, false) && (parseDateToken(item.endDate, true) || /present/i.test(item.endDate))).length;
  const roleCompanyPatternCount = meaningful.filter((item) => item.role.trim() && item.company.trim()).length;
  const totalMonths = estimateTotalExperienceMonths(meaningful);
  const shortSingleRole = roleCount <= 1 && totalMonths <= 12 && roleCompanyPatternCount === 0;

  if (roleCount === 0) return 'FRESHER' as const;
  if (roleCount >= 2 || distinctCompanies >= 2 || totalMonths > 36) return 'SENIOR' as const;
  if (roleCount >= 1 && roleCount <= 2 && rolesWithDate >= 1) return 'MID' as const;
  if (shortSingleRole) return 'FRESHER' as const;

  const text = input.resumeText.toLowerCase();
  if (/(intern|internship|student|fresher|entry level|entry-level|junior)/.test(text) && totalMonths < 24) {
    return 'FRESHER' as const;
  }
  if (/(principal|staff|lead|architect|director|head|vp|vice president|senior)/.test(text)) {
    return 'SENIOR' as const;
  }
  return 'MID' as const;
}

﻿function validatePdfExportSafety(resume: {
  summary: string;
  skills: string[];
  experience: unknown;
  education: unknown;
  projects?: unknown;
  certifications?: unknown;
}, options?: { enforceMinimumScore?: boolean }) {
  const errors: string[] = [];
  const text = buildResumeText(resume);
  const hasUnsafeFormatting = /<[^>]+>/.test(text) || /[\t|]/.test(text) || /[•◦▪★✓]/.test(text);
  if (hasUnsafeFormatting) {
    errors.push('Resume contains unsupported formatting for ATS-safe PDF export.');
  }

  const result = computeAtsScore({
    resumeText: text,
    jdText: '',
    skills: Array.isArray(resume.skills) ? resume.skills : [],
    sections: {
      summary: Boolean(resume.summary?.trim()),
      experience: Array.isArray(resume.experience) && resume.experience.length > 0,
      education: Array.isArray(resume.education) && resume.education.length > 0,
      skills: Array.isArray(resume.skills) && resume.skills.length >= 3,
    },
    bullets: collectBullets(resume),
    experienceCount: Array.isArray(resume.experience) ? resume.experience.length : 0,
  });

  const shouldEnforceMinimumScore = options?.enforceMinimumScore ?? true;
  if (shouldEnforceMinimumScore && result.roleAdjustedScore < MIN_PDF_ATS_SCORE) {
    errors.push(`ATS score must be at least ${MIN_PDF_ATS_SCORE} before export.`);
  }
  if (result.rejectionReasons.length) {
    errors.push(...result.rejectionReasons);
  }

  if (errors.length) {
    throw new BadRequestException({ errors });
  }
}
function renderResumeHtml(resume: any): string {
  const summary = escapeHtml(resume.summary || '');
  const skills = Array.isArray(resume.skills) ? resume.skills : [];
  const experience = Array.isArray(resume.experience) ? resume.experience : [];
  const education = Array.isArray(resume.education) ? resume.education : [];
  const projects = Array.isArray(resume.projects) ? resume.projects : [];
  const certifications = Array.isArray(resume.certifications) ? resume.certifications : [];
  const contact = resume.contact || {};

  const skillsList = skills.map((s: string) => `<li>${escapeHtml(s)}</li>`).join('');
  const expBlocks = experience
    .map((e: any) => {
      const highlights = Array.isArray(e.highlights) ? e.highlights : [];
      const highlightList = highlights.map((h: string) => `<li>${escapeHtml(h)}</li>`).join('');
      return `
        <div class="item">
          <div class="item-head">
            <strong>${escapeHtml(e.role || '')}</strong> - ${escapeHtml(e.company || '')}
            <span class="dates">${escapeHtml(e.startDate || '')} - ${escapeHtml(e.endDate || '')}</span>
          </div>
          <ul>${highlightList}</ul>
        </div>
      `;
    })
    .join('');

  const eduBlocks = education
    .map((e: any) => {
      const details = Array.isArray(e.details) ? e.details : [];
      const detailList = details.map((d: string) => `<li>${escapeHtml(d)}</li>`).join('');
      return `
        <div class="item">
          <div class="item-head">
            <strong>${escapeHtml(e.degree || '')}</strong> - ${escapeHtml(e.institution || '')}
            <span class="dates">${escapeHtml(e.startDate || '')} - ${escapeHtml(e.endDate || '')}</span>
          </div>
          <ul>${detailList}</ul>
        </div>
      `;
    })
    .join('');

  const projectBlocks = projects
    .map((p: any) => {
      const highlights = Array.isArray(p.highlights) ? p.highlights : [];
      const highlightList = highlights.map((h: string) => `<li>${escapeHtml(h)}</li>`).join('');
      return `
        <div class="item">
          <div class="item-head">
            <strong>${escapeHtml(p.name || '')}</strong>
            <span class="dates">${escapeHtml(p.startDate || '')} - ${escapeHtml(p.endDate || '')}</span>
          </div>
          ${p.role ? `<div class="meta">${escapeHtml(p.role)}</div>` : ''}
          <ul>${highlightList}</ul>
        </div>
      `;
    })
    .join('');

  const certBlocks = certifications
    .map((c: any) => {
      const details = Array.isArray(c.details) ? c.details : [];
      const detailList = details.map((d: string) => `<li>${escapeHtml(d)}</li>`).join('');
      return `
        <div class="item">
          <div class="item-head">
            <strong>${escapeHtml(c.name || '')}</strong>
            <span class="dates">${escapeHtml(c.date || '')}</span>
          </div>
          ${c.issuer ? `<div class="meta">${escapeHtml(c.issuer)}</div>` : ''}
          ${detailList ? `<ul>${detailList}</ul>` : ''}
        </div>
      `;
    })
    .join('');

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(resume.title || 'Resume')}</title>
    <style>
      body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11pt; line-height: 1.4; }
      h1, h2 { margin: 0 0 6px 0; }
      h2 { font-size: 12pt; margin-top: 14px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
      .contact { margin-top: 4px; font-size: 10pt; color: #333; }
      .meta { font-size: 10pt; color: #333; margin-top: 2px; }
      .section { margin-top: 12px; }
      .item { margin-top: 8px; }
      .item-head { display: flex; justify-content: space-between; gap: 8px; font-weight: 600; }
      .dates { font-weight: 400; }
      ul { margin: 6px 0 0 16px; padding: 0; }
      li { margin-bottom: 3px; }
      .summary { margin-top: 6px; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(resume.title || 'Resume')}</h1>
    <div class="contact">
      ${escapeHtml(contact.fullName || '')}
      ${contact.email ? ` | ${escapeHtml(contact.email)}` : ''}
      ${contact.phone ? ` | ${escapeHtml(contact.phone)}` : ''}
      ${contact.location ? ` | ${escapeHtml(contact.location)}` : ''}
      ${Array.isArray(contact.links) ? contact.links.map((l: string) => ` | ${escapeHtml(l)}`).join('') : ''}
    </div>
    <div class="section">
      <h2>Summary</h2>
      <p class="summary">${summary}</p>
    </div>
    <div class="section">
      <h2>Skills</h2>
      <ul>${skillsList}</ul>
    </div>
    <div class="section">
      <h2>Experience</h2>
      ${expBlocks || '<p>No experience listed.</p>'}
    </div>
    <div class="section">
      <h2>Education</h2>
      ${eduBlocks || '<p>No education listed.</p>'}
    </div>
    ${projectBlocks ? `
    <div class="section">
      <h2>Projects</h2>
      ${projectBlocks}
    </div>` : ''}
    ${certBlocks ? `
    <div class="section">
      <h2>Certifications</h2>
      ${certBlocks}
    </div>` : ''}
  </body>
</html>
`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function collectBullets(resume: { experience: unknown; education: unknown; projects?: unknown }) {
  const experience = Array.isArray(resume.experience) ? resume.experience : [];
  const education = Array.isArray(resume.education) ? resume.education : [];
  const expBullets = experience.flatMap((e: any) => Array.isArray(e.highlights) ? e.highlights : []);
  const eduBullets = education.flatMap((e: any) => Array.isArray(e.details) ? e.details : []);
  const projects = Array.isArray(resume.projects) ? resume.projects : [];
  const projectBullets = projects.flatMap((p: any) => Array.isArray(p.highlights) ? p.highlights : []);
  return { expBullets: expBullets.concat(projectBullets), eduBullets };
}

function buildResumeText(resume: { summary: string; experience: unknown; education: unknown; skills: string[]; projects?: unknown; certifications?: unknown }) {
  const experience = Array.isArray(resume.experience) ? resume.experience : [];
  const education = Array.isArray(resume.education) ? resume.education : [];
  const projects = Array.isArray(resume.projects) ? resume.projects : [];
  const certifications = Array.isArray(resume.certifications) ? resume.certifications : [];
  const expText = experience
    .map((e: any) => [e.role, e.company, ...(e.highlights || [])].join(' '))
    .join(' ');
  const eduText = education
    .map((e: any) => [e.degree, e.institution, ...(e.details || [])].join(' '))
    .join(' ');
  const projText = projects
    .map((p: any) => [p.name, p.role, ...(p.highlights || [])].join(' '))
    .join(' ');
  const certText = certifications
    .map((c: any) => [c.name, c.issuer, ...(c.details || [])].join(' '))
    .join(' ');
  return [resume.summary, expText, eduText, projText, certText, resume.skills.join(' ')].filter(Boolean).join(' ');
}

function computeAtsScore(input: {
  resumeText: string;
  jdText: string;
  skills: string[];
  sections: { summary: boolean; experience: boolean; education: boolean; skills: boolean };
  bullets: { expBullets: string[]; eduBullets: string[] };
  experienceCount: number;
}) {
  const resumeTokens = tokenize(input.resumeText);
  const jdText = String(input.jdText || '').trim();
  const hasJobDescription = jdText.length > 0;
  const jdTokens = hasJobDescription ? tokenize(jdText) : new Set<string>();
  const jdKeywordWeights = hasJobDescription ? extractKeywordWeights(jdText, 24) : new Map<string, number>();
  const jdKeywords = Array.from(jdKeywordWeights.keys());

  const keywordOverlapScore = hasJobDescription && jdKeywords.length
    ? jdKeywords.reduce((acc, k) => acc + (resumeTokens.has(k) ? (jdKeywordWeights.get(k) || 0) : 0), 0) /
      totalWeight(jdKeywordWeights)
    : 0;

  const skillCoverageScore = hasJobDescription && input.skills.length && jdKeywords.length
    ? input.skills.filter((s) => jdTokens.has(s.toLowerCase())).length / input.skills.length
    : 0;

  const roleLevel = detectRoleLevel({
    resumeText: input.resumeText,
    jdText,
    experienceCount: input.experienceCount,
  });

  const sectionWeights = getSectionWeights(roleLevel);

  const sectionCompleteness =
    Number(input.sections.experience) * sectionWeights.experience +
    Number(input.sections.skills) * sectionWeights.skills +
    Number(input.sections.education) * sectionWeights.education +
    Number(input.sections.summary) * sectionWeights.summary;

  const bulletQuality = scoreBullets(input.bullets.expBullets);
  const actionVerbScore = bulletQuality.actionVerbRatio;
  const bulletDensityScore = bulletQuality.densityScore;

  const semanticSimilarity = hasJobDescription
    ? cosineSimilarity(embedding(input.resumeText), embedding(jdText))
    : 0;

  const weights = selectScoringWeights(roleLevel);

  const roleAdjustedScore =
    weights.keyword * keywordOverlapScore +
    weights.skill * skillCoverageScore +
    weights.sections * sectionCompleteness +
    weights.semantic * semanticSimilarity +
    weights.bullets * ((actionVerbScore + bulletDensityScore) / 2);

  const atsScore = Math.max(5, Math.min(100, Math.round(roleAdjustedScore * 100)));
  const missingKeywords = hasJobDescription
    ? jdKeywords.filter((k) => !resumeTokens.has(k))
    : [];

  const rejectionReasons: string[] = [];
  if (!input.sections.experience) rejectionReasons.push('Missing Experience section.');
  if (!input.sections.skills) rejectionReasons.push('Missing Skills section (minimum 3 skills).');
  if (!input.sections.education) rejectionReasons.push('Missing Education section.');
  if (bulletQuality.tooLongCount > 0) rejectionReasons.push('Bullets exceed recommended length.');
  if (actionVerbScore < ACTION_VERB_REQUIRED_RATIO) {
    rejectionReasons.push(bulletQuality.actionVerbRule.message);
  }

  const improvementSuggestions = buildSuggestions({
    missingKeywords,
    sections: input.sections,
    jdProvided: hasJobDescription,
    bulletQuality,
  });

  const details = [
    `Role level: ${roleLevel}.`,
    `Keyword relevance: ${(keywordOverlapScore * 100).toFixed(0)}%.`,
    `Skill coverage: ${(skillCoverageScore * 100).toFixed(0)}%.`,
    `Section weighting: ${(sectionCompleteness * 100).toFixed(0)}%.`,
    `Bullet quality: ${Math.round(((actionVerbScore + bulletDensityScore) / 2) * 100)}%.`,
    `Action verbs: ${bulletQuality.actionVerbRule.percentage}% (${bulletQuality.actionVerbRule.strongBullets}/${bulletQuality.actionVerbRule.totalBullets}).`,
    `Semantic similarity: ${(semanticSimilarity * 100).toFixed(0)}%.`,
  ];

  return {
    atsScore,
    roleLevel,
    roleAdjustedScore: Math.round(roleAdjustedScore * 100),
    rejectionReasons,
    improvementSuggestions,
    details,
    missingKeywords,
    actionVerbRule: {
      requiredRatio: bulletQuality.actionVerbRule.requiredRatio,
      percentage: bulletQuality.actionVerbRule.percentage,
      strongBullets: bulletQuality.actionVerbRule.strongBullets,
      totalBullets: bulletQuality.actionVerbRule.totalBullets,
      requiredStrongBullets: bulletQuality.actionVerbRule.requiredStrongBullets,
      remainingToPass: bulletQuality.actionVerbRule.remainingToPass,
      passes: bulletQuality.actionVerbRule.passes,
      failedBullets: bulletQuality.actionVerbRule.failingBullets.map((item) => ({
        index: item.index,
        text: item.text,
        reason: item.reason,
        suggestions: item.suggestions,
      })),
      message: bulletQuality.actionVerbRule.message,
    },
    jobDescriptionUsed: hasJobDescription,
  };
}
﻿type RoleLevel = 'FRESHER' | 'MID' | 'SENIOR';

type RoleLevelWeightSet = {
  keyword: number;
  skill: number;
  sections: number;
  semantic: number;
  bullets: number;
};

type BulletPointer = {
  section: 'experience' | 'projects';
  resumeSectionId: string;
  itemId: string;
  bulletId: string;
  field: string;
};

function getSectionWeights(roleLevel: RoleLevel) {
  if (roleLevel === 'FRESHER') {
    return { experience: 0.2, skills: 0.4, education: 0.2, summary: 0.2 };
  }
  if (roleLevel === 'SENIOR') {
    return { experience: 0.5, skills: 0.2, education: 0.1, summary: 0.2 };
  }
  return { experience: 0.35, skills: 0.3, education: 0.15, summary: 0.2 };
}

function selectScoringWeights(roleLevel: RoleLevel): RoleLevelWeightSet {
  if (roleLevel === 'FRESHER') {
    return { keyword: 0.28, skill: 0.24, sections: 0.2, semantic: 0.12, bullets: 0.16 };
  }
  if (roleLevel === 'SENIOR') {
    return { keyword: 0.2, skill: 0.12, sections: 0.28, semantic: 0.2, bullets: 0.2 };
  }
  return { keyword: 0.3, skill: 0.2, sections: 0.22, semantic: 0.16, bullets: 0.12 };
}

function collectBulletPointers(resume: any, resumeId?: string): BulletPointer[] {
  const pointers: BulletPointer[] = [];
  let normalizedIndex = 0;

  const mapEntry = (section: 'experience' | 'projects', entry: any, entryIndex: number) => {
    const highlights: string[] = Array.isArray(entry.highlights) ? entry.highlights : [];
    highlights.forEach((highlight: string, highlightIndex: number) => {
      const trimmed = String(highlight || '').trim();
      if (!trimmed) return;
      const itemId = entry.id ?? `${section}-${entryIndex}`;
      pointers[normalizedIndex++] = {
        section,
        resumeSectionId: `section-${section}`,
        itemId,
        bulletId: `${resumeId || 'resume'}-${section}-${itemId}-bullet-${highlightIndex}`,
        field: `highlights[${highlightIndex}]`,
      };
    });
  };

  const experience = Array.isArray(resume.experience) ? resume.experience : [];
  experience.forEach((entry: any, index: number) => mapEntry('experience', entry, index));

  const projects = Array.isArray(resume.projects) ? resume.projects : [];
  projects.forEach((entry: any, index: number) => mapEntry('projects', entry, index));

  return pointers;
}

function buildAtsIssues(options: { failedBullets: ActionVerbFailure[]; bulletPointers: BulletPointer[]; jdUsed: boolean }) {
  const issues: AtsIssue[] = [];

  for (const failure of options.failedBullets) {
    const pointer = options.bulletPointers[failure.index];
    issues.push({
      code: 'EXP_BULLET_ACTION_VERB',
      severity: 'error',
      message:
        failure.reason === 'weak_starter'
          ? 'Start this bullet with a stronger action verb instead of a weak starter.'
          : 'Start this bullet with a dominant action verb to improve clarity.',
      section: pointer?.section ?? 'experience',
      pointer: pointer
        ? {
            resumeSectionId: pointer.resumeSectionId,
            itemId: pointer.itemId,
            bulletId: pointer.bulletId,
            field: pointer.field,
          }
        : undefined,
    });
  }

  if (!options.jdUsed) {
    issues.push({
      code: 'JD_SUGGESTION',
      severity: 'info',
      message: 'Add a job description to enhance keyword matching signals.',
      section: 'jobDescription',
      pointer: {
        resumeSectionId: 'section-jobDescription',
        field: 'jobDescription',
      },
    });
  }

  return issues;
}

function detectRoleLevel(input: { resumeText: string; jdText: string; experienceCount: number }) {
  const text = `${input.resumeText} ${input.jdText}`.toLowerCase();
  if (/(principal|staff|lead|architect|director|head|vp|vice president|senior)/.test(text)) {
    return 'SENIOR' as const;
  }
  const estimatedYears = estimateYearsFromText(text);
  if (input.experienceCount >= 2 || estimatedYears > 3) return 'SENIOR' as const;
  if (input.experienceCount >= 1 && /(19\d{2}|20\d{2})\s*(to|-|–)\s*(present|current|now|19\d{2}|20\d{2})/.test(text)) {
    return 'MID' as const;
  }
  if (/(intern|internship|student|fresher|graduate|entry level|entry-level|junior)/.test(text) && input.experienceCount <= 1) {
    return 'FRESHER' as const;
  }
  if (input.experienceCount <= 0) return 'FRESHER' as const;
  return 'MID' as const;
}

function estimateYearsFromText(text: string) {
  const years = Array.from(text.matchAll(/\b(19\d{2}|20\d{2})\b/g))
    .map((m) => Number(m[1]))
    .filter((year) => year >= 1950 && year <= new Date().getFullYear() + 1);
  if (years.length < 2) return 0;
  const min = Math.min(...years);
  const max = Math.max(...years);
  return Math.max(0, max - min);
}

function scoreBullets(bullets: string[]) {
  if (!bullets.length) {
    return {
      actionVerbRatio: 0,
      densityScore: 0,
      tooLongCount: 0,
      actionVerbRule: analyzeActionVerbRule([], ACTION_VERB_REQUIRED_RATIO),
    };
  }
  const normalized = bullets.map((b) => b.trim()).filter(Boolean);
  const actionVerbRule = analyzeActionVerbRule(normalized, ACTION_VERB_REQUIRED_RATIO);
  const tooLongCount = normalized.filter((b) => wordCount(b) > 28).length;
  const avgWords = normalized.reduce((acc, b) => acc + wordCount(b), 0) / normalized.length;
  const densityScore = avgWords >= 8 && avgWords <= 22 ? 1 : avgWords < 8 ? 0.5 : 0.3;
  return {
    actionVerbRatio: actionVerbRule.totalBullets ? actionVerbRule.strongBullets / actionVerbRule.totalBullets : 0,
    densityScore,
    tooLongCount,
    actionVerbRule,
  };
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function extractKeywordWeights(text: string, limit: number): Map<string, number> {
  if (!text) return new Map();
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const stop = new Set(['and', 'the', 'with', 'for', 'you', 'our', 'are', 'will', 'from', 'that', 'this', 'your']);
  const freq = new Map<string, number>();
  for (const t of tokens) {
    if (stop.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return new Map(
    Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([t, f]) => [t, Math.min(5, f)]),
  );
}

function totalWeight(weights: Map<string, number>) {
  let total = 0;
  for (const value of weights.values()) total += value;
  return total || 1;
}

function embedding(text: string, dims = 128): number[] {
  const vec = new Array(dims).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const t of tokens) {
    const idx = hashToken(t) % dims;
    vec[idx] += 1;
  }
  return vec;
}

function hashToken(token: string): number {
  let hash = 5381;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 33) ^ token.charCodeAt(i);
  }
  return Math.abs(hash);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildSuggestions(input: {
  missingKeywords: string[];
  sections: { summary: boolean; experience: boolean; education: boolean; skills: boolean };
  jdProvided: boolean;
  bulletQuality: { actionVerbRatio: number; densityScore: number; tooLongCount: number; actionVerbRule?: { message?: string } };
}): string[] {
  const suggestions: string[] = [];
  if (input.missingKeywords.length) {
    suggestions.push(`Add evidence of: ${input.missingKeywords.slice(0, 6).join(', ')}.`);
  }
  if (!input.sections.summary) {
    suggestions.push('Add a concise professional summary at the top.');
  }
  if (!input.sections.experience) {
    suggestions.push('Include at least one experience entry with quantified impact.');
  }
  if (!input.sections.education) {
    suggestions.push('Add an education section with degree and institution.');
  }
  if (!input.sections.skills) {
    suggestions.push('List at least 3 role-relevant skills.');
  }
  if (input.bulletQuality.tooLongCount > 0) {
    suggestions.push('Shorten long bullets to 8-22 words each.');
  }
  if (input.bulletQuality.actionVerbRatio < ACTION_VERB_REQUIRED_RATIO) {
    suggestions.push(input.bulletQuality.actionVerbRule?.message || 'Start most bullets with action verbs.');
  }
  if (!input.jdProvided) {
    suggestions.push('Upload a job description for better keyword matching.');
  }
  return suggestions.slice(0, 7);
}




