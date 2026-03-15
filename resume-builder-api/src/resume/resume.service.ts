import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, Optional, UnprocessableEntityException } from '@nestjs/common';
import puppeteer, { type LaunchOptions } from 'puppeteer';
import { existsSync } from 'fs';
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
import { ACTION_VERB_REQUIRED_RATIO, analyzeActionVerbRule, normalizeBulletText, type ActionVerbFailure } from './action-verb-rule';
import { SettingsService } from '../settings/settings.service';

/**
 * Resolve a Chrome/Chromium executable path for Puppeteer.
 * Priority: CHROME_EXECUTABLE_PATH env > common system paths > Puppeteer default.
 */
function resolveChromePath(): string | undefined {
  const envPath = process.env.CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  const candidates: string[] = isWin
    ? [
        `${process.env.PROGRAMFILES || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.PROGRAMFILES || 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ]
    : isMac
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ]
      : [
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome',
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/snap/bin/chromium',
        ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return undefined;
}

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
    const productFlowRestrictionsEnabled = await this.areProductFlowRestrictionsEnabled();
    const resumeCount = await this.prisma.resume.count({ where: { userId } });
    if (productFlowRestrictionsEnabled && resumeCount + 1 > normalizedUser.resumesLimit) {
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
    const productFlowRestrictionsEnabled = await this.areProductFlowRestrictionsEnabled();
    if (!productFlowRestrictionsEnabled) return;
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
    const productFlowRestrictionsEnabled = await this.areProductFlowRestrictionsEnabled();
    if (productFlowRestrictionsEnabled) {
      rateLimitOrThrow({
        key: `resume:update:${userId}`,
        limit: 20,
        windowMs: 60_000,
        message: 'Rate limit exceeded for resume updates.',
      });
    }
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
    const productFlowRestrictionsEnabled = await this.areProductFlowRestrictionsEnabled();
    const resumeCount = await this.prisma.resume.count({ where: { userId } });
    if (productFlowRestrictionsEnabled && resumeCount + 1 > normalizedUser.resumesLimit) {
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
    const productFlowRestrictionsEnabled = await this.areProductFlowRestrictionsEnabled();
    if (productFlowRestrictionsEnabled) {
      rateLimitOrThrow({
        key: `resume:ats:${userId}`,
        limit: 20,
        windowMs: 60_000,
        message: 'Rate limit exceeded for ATS scans.',
      });
    }
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
    if (productFlowRestrictionsEnabled && refreshed.atsScansUsed + 1 > refreshed.atsScansLimit) {
      if (refreshed.plan === 'FREE') {
        throw new ForbiddenException('FREE_PLAN_ATS_LIMIT_EXCEEDED: Free plan allows ATS checks for up to 2 scans.');
      }
      throw new ForbiddenException('ATS scan limit exceeded.');
    }
    const resume = normalizeResumeForAtsOutput(await this.get(userId, id));
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

  async generatePdf(userId: string, id: string, templateIdOverride?: string) {
    const productFlowRestrictionsEnabled = await this.areProductFlowRestrictionsEnabled();
    if (productFlowRestrictionsEnabled) {
      rateLimitOrThrow({
        key: `resume:pdf:${userId}`,
        limit: 8,
        windowMs: 60_000,
        message: 'Rate limit exceeded for PDF export.',
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (productFlowRestrictionsEnabled && user.plan === 'FREE') {
      throw new ForbiddenException('Free plan does not allow PDF export.');
    }
    await ensureUsagePeriod(this.prisma, user);
    const updatedUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }
    if (productFlowRestrictionsEnabled && updatedUser.pdfExportsUsed + 1 > updatedUser.pdfExportsLimit) {
      throw new ForbiddenException('PDF export limit exceeded');
    }
    const resume = await this.get(userId, id);
    // Mismatch root-cause: preview uses React template components + app CSS, while
    // export used a separate HTML/CSS builder path. Keep export on a single renderer.
    const resolvedTemplateId = resolveExportTemplateId(templateIdOverride, resume.templateId);
    validatePdfExportSafety(resume, { enforceMinimumScore: productFlowRestrictionsEnabled });
    const rendered = renderResumeTemplateHtml({
      templateId: resolvedTemplateId,
      resumeData: resume,
      mode: 'export',
    });
    const html = rendered.html;
    logExportRenderMeta({
      resumeId: id,
      templateId: resolvedTemplateId,
      cssIncluded: rendered.cssIncluded,
      renderer: 'renderResumeTemplateHtml',
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { pdfExportsUsed: updatedUser.pdfExportsUsed + 1 },
    });

    const chromePath = resolveChromePath();
    const launchOptions: LaunchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      ...(chromePath ? { executablePath: chromePath } : {}),
    };

    let browser;
    try {
      browser = await puppeteer.launch(launchOptions);
    } catch (launchError) {
      const hint = chromePath
        ? `Tried Chrome at: ${chromePath}`
        : 'No Chrome/Chromium found. Install Chrome or set CHROME_EXECUTABLE_PATH env variable.';
      console.error(`[pdf-export] Chrome launch failed. ${hint}`, launchError);
      throw new HttpException(
        `PDF generation unavailable: Chrome browser not found. ${hint}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const buffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
      });
      return buffer;
    } finally {
      await browser.close();
    }
  }

  async debugExportHtml(userId: string, id: string, templateIdOverride?: string) {
    const resume = normalizeResumeForAtsOutput(await this.get(userId, id));
    const resolvedTemplateId = resolveExportTemplateId(templateIdOverride, resume.templateId);
    const rendered = renderResumeTemplateHtml({
      templateId: resolvedTemplateId,
      resumeData: resume,
      mode: 'export',
    });
    logExportRenderMeta({
      resumeId: id,
      templateId: resolvedTemplateId,
      cssIncluded: rendered.cssIncluded,
      renderer: 'renderResumeTemplateHtml(debug)',
    });
    return {
      html: rendered.html,
      fingerprint: rendered.fingerprint,
      templateId: resolvedTemplateId,
      cssBundle: rendered.cssBundle,
    };
  }

  async recomputeResume(userId: string, id: string) {
    const resume = await this.getRaw(userId, id);
    const resumeData = resume as any;

    // Build a text representation from stored resume data for re-parsing
    const textParts: string[] = [];
    if (resumeData.contact?.fullName) textParts.push(resumeData.contact.fullName);
    if (resumeData.contact?.email) textParts.push(`Email: ${resumeData.contact.email}`);
    if (resumeData.contact?.phone) textParts.push(`Phone: ${resumeData.contact.phone}`);
    if (resumeData.contact?.location) textParts.push(`Location: ${resumeData.contact.location}`);
    if (resumeData.summary) {
      textParts.push('', 'PROFESSIONAL SUMMARY', resumeData.summary);
    }
    if (Array.isArray(resumeData.skills) && resumeData.skills.length) {
      textParts.push('', 'SKILLS', resumeData.skills.join(', '));
    }
    if (Array.isArray(resumeData.experience) && resumeData.experience.length) {
      textParts.push('', 'PROFESSIONAL EXPERIENCE');
      for (const exp of resumeData.experience) {
        if (exp.role) textParts.push(exp.role);
        if (exp.company) textParts.push(exp.company);
        if (exp.startDate || exp.endDate) textParts.push(`${exp.startDate || ''} - ${exp.endDate || ''}`);
        if (Array.isArray(exp.highlights)) {
          for (const h of exp.highlights) textParts.push(`- ${h}`);
        }
      }
    }
    if (Array.isArray(resumeData.education) && resumeData.education.length) {
      textParts.push('', 'EDUCATION');
      for (const edu of resumeData.education) {
        if (edu.degree) textParts.push(edu.degree);
        if (edu.institution) textParts.push(edu.institution);
        if (edu.startDate || edu.endDate) textParts.push(`${edu.startDate || ''} - ${edu.endDate || ''}`);
      }
    }
    if (Array.isArray(resumeData.projects) && resumeData.projects.length) {
      textParts.push('', 'PROJECTS');
      for (const proj of resumeData.projects) {
        if (proj.name) textParts.push(proj.name);
        if (Array.isArray(proj.highlights)) {
          for (const h of proj.highlights) textParts.push(`- ${h}`);
        }
      }
    }
    if (Array.isArray(resumeData.certifications) && resumeData.certifications.length) {
      textParts.push('', 'CERTIFICATIONS');
      for (const cert of resumeData.certifications) {
        if (cert.name) textParts.push(cert.name);
      }
    }

    const fullText = textParts.join('\n');
    const normalized = normalizeUploadText(fullText);
    const parsed = parseResumeText(normalized);
    const dateMatches = collectDateMatches(normalized);
    const mapped = mapParsedResume(parsed);
    const sanitized = sanitizeImportedResume({
      title: mapped.title || resume.title,
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
      fullText: normalized,
      dateMatches,
    });
    sanitized.experience = finalizedExperience;

    return {
      resumeId: id,
      text: normalized,
      parsed: {
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
      },
      debug: {
        sectionHits: summarizeSectionHits(parsed.sections),
        dateMatches,
      },
    };
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

    const normalized = normalizeUploadText(trimmed);
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
        fullText: normalized,
        dateMatches,
      });
      sanitized.experience = finalizedExperience;
      const normalizedParsed = normalizeResumeForAtsOutput({
        title: sanitized.title,
        contact: sanitized.contact,
        summary: sanitized.summary,
        skills: sanitized.skills,
        experience: sanitized.experience,
        education: sanitized.education,
        projects: sanitized.projects,
        certifications: sanitized.certifications,
      });
      const parsedPayload = {
        title: normalizedParsed.title,
        contact: normalizedParsed.contact,
        summary: normalizedParsed.summary,
        skills: normalizedParsed.skills,
        experience: normalizedParsed.experience,
        education: normalizedParsed.education,
        projects: normalizedParsed.projects,
        certifications: normalizedParsed.certifications,
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

  private async areProductFlowRestrictionsEnabled() {
    if (!this.settingsService) return false;
    const settingsService = this.settingsService as SettingsService & {
      areProductFlowRestrictionsEnabled?: () => Promise<boolean>;
    };
    if (typeof settingsService.areProductFlowRestrictionsEnabled !== 'function') {
      return false;
    }
    return settingsService.areProductFlowRestrictionsEnabled();
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
const DATE_TOKEN = String.raw`(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*\d{4}|\d{1,2}[/]\d{4}|\d{4}[/-]\d{1,2}|\b\d{4}\b)`;
const DATE_RANGE_PATTERN = new RegExp(
  `(${DATE_TOKEN})(?:\\s*(?:-|to|–|—)\\s*(?:present|current|now|${DATE_TOKEN}))?`,
  'i',
);

export function extractExperienceFromText(fullText: string, parsed?: ParsedResumeText) {
  const rawText = String(fullText || '').trim();
  if (!rawText && !(parsed?.lines?.length)) return [];
  const rawLines = rawText
    ? rawText.split(/\r?\n/).map((line) => normalizeLegacyBulletPrefix(line).trim())
    : [];
  const lines = rawLines.length
    ? rawLines
    : (parsed?.lines || []).map((line) => normalizeLegacyBulletPrefix(line).trim());
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
    let finalCompany = company;
    let finalRole = role;
    // If role is empty but company contains "Role, Company" or "Role | Company", split them
    if (!finalRole && finalCompany) {
      const commaMatch = finalCompany.match(/^(.+?),\s+(.+)$/);
      if (commaMatch) {
        finalRole = commaMatch[1].trim();
        finalCompany = commaMatch[2].trim();
      } else {
        const pipeMatch = finalCompany.match(/^(.+?)\s*\|\s*(.+)$/);
        if (pipeMatch) {
          finalRole = pipeMatch[1].trim();
          finalCompany = pipeMatch[2].trim();
        } else {
          // Trailing dash means it's a role title, not a company (e.g. "Assistant Vice President -")
          const trailingDash = finalCompany.match(/^(.+?)\s*[-–—]\s*$/);
          if (trailingDash) {
            finalRole = trailingDash[1].trim();
            finalCompany = '';
          }
        }
      }
    }
    const entry: ExperienceExtractionEntry = {
      company: finalCompany,
      role: finalRole,
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
    const rawLine = normalizeLegacyBulletPrefix(lines[index] || '');
    const line = rawLine.trim();
    if (!line) continue;
    if (/^achievements:?$/i.test(line)) continue;
    const nextLine = normalizeLegacyBulletPrefix(lines[index + 1] || '').trim();

    const inline = parseInlineExperienceLine(line);
    if (inline) {
      startEntry(inline.company, inline.role, inline.startDate, inline.endDate);
      continue;
    }

    // DOCX multi-line: if current entry has no company yet, fill it before other checks
    if (currentEntry) {
      const cur = currentEntry as ExperienceExtractionEntry;
      if (!cur.company && !cur.highlights.length && !highlightBuffer && looksLikeCompanyName(line)) {
        cur.company = line;
        continue;
      }
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
  const tokens = range.split(/(?:-|to|\u2014|\u2013)/i).map((token) => token.trim()).filter(Boolean);
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

function looksLikeCompanyName(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return false;
  if (/^[-•*]/.test(trimmed)) return false;
  if (trimmed.includes('. ') || trimmed.endsWith('.')) return false;
  if (NARRATIVE_VERB_PATTERN.test(trimmed)) return false;
  if (COMPANY_KEYWORD_PATTERN.test(trimmed)) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 6 && words.every((w) => /^[A-Z&]/.test(w))) return true;
  return false;
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
  return normalizeLegacyBulletPrefix(line).replace(/^[-*]\s*/, '').trim();
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

  return normalizeResumeForAtsOutput({
    ...input,
    experience: normalizedExperience,
    education: normalizedEducation,
    projects: normalizedProjects,
    certifications: normalizedCertifications,
  });
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

function normalizeResumeForAtsOutput(input: any) {
  const experience = sortExperienceChronological(
    (Array.isArray(input?.experience) ? input.experience : [])
      .map((item: any) => ({
        company: cleanExperienceValue(item?.company || ''),
        role: cleanRoleText(item?.role || ''),
        startDate: normalizeExportDateToken(item?.startDate || '', false),
        endDate: normalizeExportDateToken(item?.endDate || '', true),
        highlights: sanitizeBulletList(item?.highlights),
      }))
      .filter((item: any) => item.company || item.role || item.highlights.length),
  );

  const education = (Array.isArray(input?.education) ? input.education : [])
    .map((item: any) => ({
      ...item,
      institution: cleanExperienceValue(item?.institution || ''),
      degree: cleanExperienceValue(item?.degree || ''),
      startDate: normalizeExportDateToken(item?.startDate || '', false),
      endDate: normalizeExportDateToken(item?.endDate || '', false),
      details: sanitizeBulletList(item?.details),
    }))
    .filter((item: any) => item.institution || item.degree || (item.details || []).length);

  const projects = (Array.isArray(input?.projects) ? input.projects : [])
    .map((item: any) => ({
      ...item,
      name: cleanExperienceValue(item?.name || ''),
      role: cleanRoleText(item?.role || ''),
      startDate: normalizeExportDateToken(item?.startDate || '', false) || undefined,
      endDate: normalizeExportDateToken(item?.endDate || '', false) || undefined,
      highlights: sanitizeBulletList(item?.highlights),
    }))
    .filter((item: any) => item.name || item.highlights.length);

  const certifications = (Array.isArray(input?.certifications) ? input.certifications : [])
    .map((item: any) => ({
      ...item,
      name: cleanExperienceValue(item?.name || ''),
      issuer: cleanExperienceValue(item?.issuer || ''),
      date: normalizeExportDateToken(item?.date || '', false) || undefined,
      details: sanitizeBulletList(item?.details),
    }))
    .filter((item: any) => item.name);

  return {
    ...input,
    summary: String(input?.summary || '').replace(/\s+/g, ' ').trim(),
    skills: dedupeSkills(Array.isArray(input?.skills) ? input.skills : []),
    technicalSkills: dedupeSkills(Array.isArray(input?.technicalSkills) ? input.technicalSkills : []),
    softSkills: dedupeSkills(Array.isArray(input?.softSkills) ? input.softSkills : []),
    languages: dedupeLanguages(Array.isArray(input?.languages) ? input.languages : []),
    experience,
    education,
    projects,
    certifications,
  };
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
  return normalizeResumeForAtsOutput({
    ...resume,
    contact: cleanContactForResponse(resume?.contact),
    skills: normalized.skills,
    technicalSkills: normalized.technicalSkills,
    softSkills: normalized.softSkills,
    languages: normalized.languages,
  });
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
  if (file.mimetype === 'text/html' || ext === 'html' || ext === 'htm') {
    return extractHtmlText(file.buffer);
  }
  if (file.mimetype === 'application/rtf' || file.mimetype === 'text/rtf' || ext === 'rtf') {
    return extractRtfText(file.buffer);
  }
  if (file.mimetype === 'application/msword' || ext === 'doc') {
    throw new BadRequestException({
      errors: ['Legacy .doc format is not supported. Please save the file as .docx or .pdf and re-upload.'],
    });
  }
  throw new BadRequestException({
    errors: [`unsupported mimetype: ${file.mimetype || 'unknown'}; allowed types are PDF, DOCX, TXT, HTML, RTF.`],
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
    // Use convertToHtml to preserve heading structure, then convert to plain text
    // mammoth.extractRawText() loses all formatting which breaks section detection
    const htmlResult = await mammoth.convertToHtml({ buffer });
    const html = htmlResult.value || '';
    if (!html.trim()) {
      // Fallback to raw text if HTML conversion returns empty
      const rawResult = await mammoth.extractRawText({ buffer });
      return rawResult.value || '';
    }
    return convertDocxHtmlToStructuredText(html);
  } catch {
    throw new BadRequestException({
      errors: ['Unable to extract readable text from DOCX.'],
    });
  }
}

/**
 * Convert mammoth HTML output to structured plain text that preserves
 * heading markers (uppercase) and list structure (bullet prefixes).
 */
function convertDocxHtmlToStructuredText(html: string): string {
  let text = html;

  // Convert headings to UPPERCASE lines (preserves section detection)
  text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, inner) => {
    const cleaned = stripHtmlTags(inner).trim();
    return cleaned ? `\n\n${cleaned.toUpperCase()}\n` : '';
  });

  // Handle paragraphs that contain bold text — extract bold segments as potential headings
  // Covers: <p><strong>Heading</strong> rest</p>, <p><b>Heading</b></p>,
  //         <p><strong><em>Heading</em></strong></p>, multiple bold segments, etc.
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner) => {
    const innerTrimmed = inner.trim();
    if (!innerTrimmed) return '\n';

    // Extract all bold segments from this paragraph
    const boldSegments: string[] = [];
    const boldRe = /<(?:strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/(?:strong|b)>/gi;
    let boldMatch: RegExpExecArray | null;
    while ((boldMatch = boldRe.exec(innerTrimmed)) !== null) {
      const boldText = stripHtmlTags(boldMatch[1]).trim();
      if (boldText) boldSegments.push(boldText);
    }

    // Get the full plain text of the paragraph
    const fullText = stripHtmlTags(innerTrimmed).trim();
    if (!fullText) return '\n';

    // If no bold text, just output as regular paragraph
    if (!boldSegments.length) {
      return `\n${fullText}\n`;
    }

    // Check if the bold segments look like headings
    const boldCombined = boldSegments.join(' ').trim();
    const isHeadingLike = boldCombined.length <= 80 && !/[.,;!?]/.test(boldCombined);
    const restText = fullText.replace(boldCombined, '').trim();

    // If the entire paragraph is bold, treat as heading
    if (!restText && isHeadingLike) {
      return `\n\n${boldCombined.toUpperCase()}\n`;
    }

    // If bold text at start looks like heading + non-bold content follows
    if (isHeadingLike && fullText.startsWith(boldCombined) && restText) {
      return `\n\n${boldCombined.toUpperCase()}\n${restText}\n`;
    }

    // If bold text is a section heading or role-like, split it out
    if (isHeadingLike && restText) {
      return `\n\n${boldCombined.toUpperCase()}\n${restText}\n`;
    }

    // Default: keep as a regular paragraph
    return `\n${fullText}\n`;
  });

  // Convert list items to bullet points
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => {
    const cleaned = stripHtmlTags(inner).trim();
    return cleaned ? `\n- ${cleaned}` : '';
  });

  // Remove list wrappers
  text = text.replace(/<\/?(?:ul|ol)[^>]*>/gi, '');

  // Convert <br> to newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Remove remaining HTML tags
  text = stripHtmlTags(text);

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ');

  // Post-process: split lines that contain embedded section headings
  text = splitEmbeddedSectionHeadings(text);

  // Clean up whitespace
  text = text
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  return text;
}

/**
 * Known section heading phrases used in resumes.
 * When these appear mid-line in extracted text, we split them onto their own line.
 */
const RESUME_SECTION_HEADINGS = [
  'Professional Experience',
  'Work Experience',
  'Employment History',
  'Experience',
  'Profile Summary',
  'Professional Summary',
  'Summary',
  'Key Skill',
  'Key Skills',
  'Technical Skills',
  'Core Skills',
  'Skills',
  'Education',
  'Academic Background',
  'Certifications',
  'Certificates',
  'Projects',
  'Notable Projects',
  'Accomplishments',
  'Achievements',
  'Languages',
  'Core Competencies',
  'Competencies',
];

/**
 * Detect known section headings embedded in the middle of lines and split them out.
 * Also detect "Technologies:" / "Technologies -" lines that should be separate from experience entries.
 */
function splitEmbeddedSectionHeadings(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      output.push('');
      continue;
    }

    let handled = false;
    for (const heading of RESUME_SECTION_HEADINGS) {
      // Check if heading appears mid-line (not at position 0)
      const idx = trimmed.indexOf(heading);
      if (idx > 0) {
        // Found heading in the middle of a line — split before it
        const before = trimmed.substring(0, idx).trim();
        const after = trimmed.substring(idx).trim();
        if (before) output.push(before);
        output.push('');
        output.push(after.toUpperCase().startsWith(heading.toUpperCase()) ? after : after);
        handled = true;
        break;
      }
    }

    if (!handled) {
      // Split "Technologies - HTML, CSS..." or "Technologies: HTML, CSS..." onto their own line
      // and separate them from the next experience entry
      const techMatch = trimmed.match(/^(Technologies\s*[-:]\s*.+?)(\s+(?:Senior|Junior|Lead|Associate|Principal|Staff|Chief|Vice|Assistant|Manager|Director|Engineer|Developer|Consultant|Analyst|Architect|Specialist|Executive|Officer|President|Intern|Trainee)\b.+)/i);
      if (techMatch) {
        output.push(techMatch[1].trim());
        output.push('');
        output.push(techMatch[2].trim());
      } else {
        output.push(trimmed);
      }
    }
  }

  return output.join('\n');
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function extractHtmlText(buffer: Buffer): string {
  const html = buffer.toString('utf8');
  return convertDocxHtmlToStructuredText(html);
}

function extractRtfText(buffer: Buffer): string {
  const rtf = buffer.toString('utf8');
  let text = rtf;

  // Remove RTF header/footer
  text = text.replace(/^\{\\rtf[^}]*\}?/, '');

  // Remove RTF control words but keep text content
  // Handle unicode escapes: \u12345? -> character
  text = text.replace(/\\u(\d+)\??/g, (_m, code) => {
    try { return String.fromCharCode(parseInt(code, 10)); } catch { return ''; }
  });

  // Remove font tables, color tables, style sheets
  text = text.replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|header|footer|pict)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');

  // Convert RTF paragraph marks to newlines
  text = text.replace(/\\par\b/g, '\n');
  text = text.replace(/\\line\b/g, '\n');
  text = text.replace(/\\tab\b/g, ' ');

  // Remove remaining RTF control words (e.g., \b, \i, \fs24)
  text = text.replace(/\\[a-z]+\d*\s?/gi, '');

  // Remove curly braces
  text = text.replace(/[{}]/g, '');

  // Clean up whitespace
  text = text
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  return text;
}

function normalizeText(text: string) {
  return text
    .replace(/\u0000/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[•◦▪●]/g, '- ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const LEGACY_BULLET_PREFIX_RE = /^\s*(?:[-*•·]+|\d{1,3}[.)]|[a-z][.)])?\s*(impact|achievement|result|highlights?|accomplishment)s?:\s*/i;

export function normalizeUploadText(text: string) {
  const basic = normalizeText(text)
    .split('\n')
    .map((line) => normalizeLegacyBulletPrefix(line))
    .join('\n')
    .trim();

  // Split concatenated date patterns from ATS PDF extraction.
  // pdf-parse sometimes merges adjacent HTML elements without newlines:
  //   "Citi CorpDec 2022 - Present" → "Citi Corp\nDec 2022 - Present"
  //   "EnterprisesSep 2020" → "Enterprises\nSep 2020"
  const deconcat = splitConcatenatedDates(basic);

  // Post-process: restructure flat text by splitting on known patterns
  const restructured = restructureResumeText(deconcat);

  // Merge fragmented lines that mammoth splits across multiple lines
  // (e.g. "Assistant\nVice President -" → "Assistant Vice President -")
  const merged = mergeFragmentedLines(restructured);

  // Fix multi-column PDF layout: sidebar skills mixed into experience,
  // header info in skills section, dates at page boundaries, etc.
  return fixMultiColumnPdfLayout(merged);
}

/**
 * Split date patterns that pdf-parse concatenated to preceding text.
 *
 * When Puppeteer renders ATS HTML to PDF, adjacent block elements
 * (e.g. <h3>Role, Company</h3><p>Dec 2022 - Present</p>) sometimes
 * get extracted by pdf-parse as a single line without separating whitespace:
 *   "AVP, Citi CorpDec 2022 - Present" → should be two lines
 *   "One Network EnterprisesSep 2020 - Sep 2021" → should be two lines
 *   "Indian Institute of Technology DelhiJul 2008 - Aug 2012" → should be two lines
 *
 * Also handles MM/YYYY and YYYY concatenation without spaces.
 */
export function splitConcatenatedDates(text: string): string {
  // 1. Split month name directly concatenated to preceding letter, including
  //    cases where there's no space between month and year (e.g. "CorpDec2022").
  //    Also normalizes the space between month and year in one pass.
  //    e.g. "CorpDec 2022" → "Corp\nDec 2022"
  //    e.g. "CorpDec2022" → "Corp\nDec 2022"
  let result = text.replace(
    /([a-zA-Z])((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*)\s*(\d{4})/gi,
    (match, prefix, month, year) => {
      // Don't split if the prefix char is part of the month itself
      // e.g. don't split "December 2022" → the prefix 'D' + month "ecember" forms a full month name
      const combined = prefix + month;
      if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)(?:uary|ruary|ch|il|e|y|ust|tember|ober|ember)?$/i.test(combined)) {
        return `${combined} ${year}`;
      }
      return `${prefix}\n${month} ${year}`;
    },
  );

  // 2. Split MM/YYYY or MM-YYYY concatenated to preceding letter
  //    e.g. "Company01/2020" → "Company\n01/2020"
  result = result.replace(
    /([a-zA-Z])(\d{1,2}[/-]\d{4})/g,
    '$1\n$2',
  );

  // 3. Split bare YYYY concatenated to preceding letter when followed by a date separator
  //    e.g. "Company2020 - Present" → "Company\n2020 - Present"
  result = result.replace(
    /([a-zA-Z])((?:19|20)\d{2})(?=\s*(?:\s-\s|-|–|—|to)\s)/gi,
    '$1\n$2',
  );

  // 5. Split short degree codes concatenated with institution names
  //    e.g. "BBIndian Institute" → "BB\nIndian Institute"
  //    Pattern: 2-4 uppercase letters directly followed by a capitalized word
  //    (only within education-like context — after an EDUCATION heading)
  const educationStart = result.search(/\bEDUCATION\b/i);
  if (educationStart >= 0) {
    const before = result.substring(0, educationStart);
    const after = result.substring(educationStart);
    const fixedAfter = after.replace(
      /^([A-Z]{2,5})([A-Z][a-z]{2,})/gm,
      '$1\n$2',
    );
    result = before + fixedAfter;
  }

  return result;
}

/**
 * Restructure flat/poorly-formatted resume text to ensure section headings
 * and experience entries are on separate lines.
 *
 * Handles common patterns like:
 *   "Professional Experience Senior Developer - 01/2020 to Present Company Name"
 *   "Technologies- HTML, CSS Senior Consultant - 10/2021 to 12/2022 Ernst & Young"
 */
function restructureResumeText(text: string): string {
  const SECTION_HEADING_NAMES = [
    'Professional Experience', 'Work Experience', 'Employment History',
    'Profile Summary', 'Professional Summary', 'Career Summary', 'Career Objective',
    'Key Skills', 'Key Skill', 'Technical Skills', 'Core Skills', 'Core Competencies',
    'Key Competencies', 'Technical Expertise', 'Functional Skills', 'Domain Expertise',
    'Skill Set', 'Areas of Expertise',
    'Certifications', 'Certification', 'Certificates', 'Professional Certifications',
    'Accomplishments', 'Achievements',
    'Education', 'Academic Background', 'Qualifications', 'Education History',
    'Educational Qualifications', 'Academic Qualifications',
    'Projects', 'Notable Projects', 'Key Projects',
    'Career History', 'Work History',
    'Languages', 'Soft Skills',
    'Summary', 'Skills', 'Experience',
  ];

  const ROLE_KEYWORDS_RE = /(?:Senior|Junior|Lead|Associate|Principal|Staff|Chief|Vice|Assistant|Manager|Director|Engineer|Developer|Consultant|Analyst|Architect|Specialist|Executive|Officer|President|Intern|Trainee|Coordinator|Administrator|Head|Founder|Owner|AVP|Systems?)\b/;

  // Date token patterns: "MM/YYYY", "Mon YYYY", "YYYY"
  const DATE_TOKEN = '(?:\\d{1,2}[/-]\\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\s+\\d{4}|\\d{4})';
  const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|to|–|—)\\s*((?:Current|Present|Now|Till Date|Till date)|${DATE_TOKEN})`, 'i');

  let result = text;

  // 1. Ensure contact labels start on new lines
  result = result.replace(/(?<=\S)\s*(E-?mail\s*:)/gi, '\n$1');
  result = result.replace(/(?<=\S)\s*(Mobile\s*(?:No\.?)?\s*:)/gi, '\n$1');
  result = result.replace(/(?<=\S)\s*(Phone\s*:)/gi, '\n$1');
  result = result.replace(/(?<=\S)\s*(Address\s*:)/gi, '\n$1');
  result = result.replace(/(?<=\S)\s*(LinkedIn\s*:)/gi, '\n$1');
  result = result.replace(/(?<=\S)\s*(Date of Birth\s*:)/gi, '\n$1');
  result = result.replace(/(?<=\S)\s*(DOB\s*:)/gi, '\n$1');
  result = result.replace(/(?<=\S)\s*(Nationality\s*:)/gi, '\n$1');

  // 2. Process line-by-line to split section headings from content
  const lines = result.split('\n');
  const output: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { output.push(''); continue; }

    let matched = false;

    // Try to find a section heading at the START or MIDDLE of this line
    // Sort headings longest-first to match "Professional Experience" before "Experience"
    const sortedHeadings = [...SECTION_HEADING_NAMES].sort((a, b) => b.length - a.length);
    for (const heading of sortedHeadings) {
      const re = new RegExp(`^(.*?)\\b(${escapeRegExp(heading)})\\b(.*)$`, 'i');
      const match = line.match(re);
      if (!match) continue;

      const before = match[1].trim();
      const headingText = match[2];
      const after = match[3].trim();

      // Don't split if the heading is part of a longer phrase that isn't actually a heading
      // e.g. "I have experience in..." — heading "Experience" is mid-sentence
      // But DO split if the before-text is long (> 100 chars = likely concatenated blocks)
      if (before && /[a-z]$/.test(before) && !/[.!?;:,]$/.test(before) && before.length < 100) continue;

      if (before) output.push(before);
      output.push('');
      // Put heading on its own line in uppercase
      output.push(headingText.toUpperCase());
      if (after) output.push(after);
      matched = true;
      break;
    }

    if (matched) continue;

    // 3. Split "Technologies[-:] list RoleTitle..." into separate lines
    const techMatch = line.match(
      new RegExp(`^(Technologies\\s*[-:]\\s*[^\\n]+?)\\s+(${ROLE_KEYWORDS_RE.source}.+)`, 'i'),
    );
    if (techMatch) {
      output.push(techMatch[1].trim());
      output.push(techMatch[2].trim());
      continue;
    }

    // 4. Split "RoleTitle - DateRange CompanyName - optional bullet" format
    // Handles: "Senior Developer - 01/2020 to Present Company Name - Led team"
    //          "Senior Developer - Jan 2020 to Present Company Name"
    const roleDateCompanyMatch = line.match(
      new RegExp(`^(.+?)\\s*-\\s*(${DATE_RANGE_RE.source})\\s+([A-Z][A-Za-z\\s&.,()]+?)(?:\\s*-\\s+(.+))?$`, 'i'),
    );
    if (roleDateCompanyMatch) {
      const role = roleDateCompanyMatch[1].trim();
      const dateRange = roleDateCompanyMatch[2].trim();
      const company = roleDateCompanyMatch[role.length + dateRange.length > 0 ? 3 : 4]?.trim();
      const rest = line.substring(line.indexOf(dateRange) + dateRange.length).trim();
      // Re-parse more carefully
      const afterDate = rest.replace(/^\s+/, '');
      const companyBulletMatch = afterDate.match(/^([A-Z][A-Za-z\s&.,()]+?)(?:\s*-\s+(.+))?$/);
      if (companyBulletMatch) {
        output.push(role);
        output.push(dateRange);
        output.push(companyBulletMatch[1].trim());
        if (companyBulletMatch[2]) output.push(`- ${companyBulletMatch[2].trim()}`);
      } else {
        output.push(role);
        output.push(dateRange);
        if (afterDate) output.push(afterDate);
      }
      continue;
    }

    // 5. Split "RoleTitle- MM/YYYY - MM/YYYY CompanyName" (dash attached to role, date range with dashes)
    const roleDateDashMatch = line.match(
      /^(.+?)-\s*(\d{1,2}[/-]\d{4})\s*[-–—]\s*(\d{1,2}[/-]\d{4}|Present|Current|Now|Till Date)\s+([A-Z][A-Za-z\s&.,()]+?)(?:\s*-\s+(.+))?$/i,
    );
    if (roleDateDashMatch) {
      const role = roleDateDashMatch[1].trim();
      const dateStr = `${roleDateDashMatch[2]} - ${roleDateDashMatch[3]}`;
      const company = roleDateDashMatch[4].trim();
      const firstBullet = roleDateDashMatch[5]?.trim();
      output.push(role);
      output.push(dateStr);
      output.push(company);
      if (firstBullet) output.push(`- ${firstBullet}`);
      continue;
    }

    // 6. Split "CompanyName RoleTitle DateRange" or "CompanyName, Location RoleTitle DateRange"
    const companyRoleDateMatch = line.match(
      new RegExp(`^([A-Z][A-Za-z\\s&.,()]+?)\\s+(${ROLE_KEYWORDS_RE.source}[^\\d]*?)\\s+(${DATE_RANGE_RE.source})\\s*$`, 'i'),
    );
    if (companyRoleDateMatch) {
      output.push(companyRoleDateMatch[1].trim());
      output.push(companyRoleDateMatch[2].trim());
      output.push(companyRoleDateMatch[3].trim());
      continue;
    }

    output.push(line);
  }

  result = output.join('\n');
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

/**
 * Merge lines that mammoth fragmented across line breaks.
 *
 * Handles:
 * 1. Split role titles: "Assistant\nVice President -" → "Assistant Vice President -"
 * 2. Split section headings: "Professional\n\nEXPERIENCE" → "PROFESSIONAL EXPERIENCE"
 * 3. False headings followed by continuation text: "LANGUAGES\nincluding HTML5..." → merged back
 * 4. "Technologies" lines separated from content
 */
function mergeFragmentedLines(text: string): string {
  const ROLE_KEYWORD_RE = /^(?:Vice\s+President|President|Director|Manager|Engineer|Developer|Consultant|Analyst|Architect|Specialist|Executive|Officer|Coordinator|Administrator|Trainee|Intern)\b/i;
  const ROLE_PREFIX_RE = /^(?:Senior|Junior|Lead|Associate|Principal|Staff|Chief|Assistant|Systems?|Technical\s+Support\s*\/?\s*)(?:\s+\S+)?$/i;
  const KNOWN_MULTI_WORD_HEADINGS: Record<string, string> = {
    'professional': 'EXPERIENCE',
    'work': 'EXPERIENCE',
    'employment': 'HISTORY',
    'career': 'HISTORY',
    'profile': 'SUMMARY',
    'academic': 'BACKGROUND',
    'education': 'HISTORY',
    'technical': 'SKILLS',
    'core': 'SKILLS',
    'key': 'SKILL',
    'notable': 'PROJECTS',
    'soft': 'SKILLS',
  };
  const CONTINUATION_WORDS_RE = /^(?:including|such\s+as|like|and|with|using|for|the|a|an|in|on|at|to|of|by)\b/i;

  const lines = text.split('\n');
  const merged: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      merged.push('');
      i++;
      continue;
    }

    // --- Rule 1: Merge split section headings ---
    // e.g. "Professional" + "" + "EXPERIENCE" → "PROFESSIONAL EXPERIENCE"
    const lineLower = line.toLowerCase().replace(/[^a-z]/g, '');
    if (KNOWN_MULTI_WORD_HEADINGS[lineLower]) {
      const expectedSuffix = KNOWN_MULTI_WORD_HEADINGS[lineLower];
      // Look ahead (skip empty lines) for the expected suffix
      let nextContentIdx = i + 1;
      while (nextContentIdx < lines.length && !lines[nextContentIdx].trim()) nextContentIdx++;
      if (nextContentIdx < lines.length) {
        const nextLine = lines[nextContentIdx].trim();
        const nextLower = nextLine.toLowerCase().replace(/[^a-z]/g, '');
        if (nextLower === expectedSuffix.toLowerCase().replace(/[^a-z]/g, '')) {
          merged.push(`${line.toUpperCase()} ${nextLine.toUpperCase()}`);
          i = nextContentIdx + 1;
          continue;
        }
      }
    }

    // --- Rule 2: Merge split role titles ---
    // Pattern: short line that looks like a role prefix, followed by a line
    // with a role keyword and optional trailing dash/date
    // e.g. "Assistant" + "Vice President -" → "Assistant Vice President -"
    //      "Senior Technology" + "Consultant -" → "Senior Technology Consultant -"
    //      "Lead UI" + "Developer-" → "Lead UI Developer-"
    //      "Senior Software" + "Developer -" → "Senior Software Developer -"
    if (line.length <= 30 && !line.startsWith('-') && ROLE_PREFIX_RE.test(line)) {
      // Look ahead (skip empty lines)
      let nextIdx = i + 1;
      while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;
      if (nextIdx < lines.length) {
        const nextLine = lines[nextIdx].trim();
        // Check if next line starts with a role keyword (possibly with trailing " -" or "-")
        const rolePartMatch = nextLine.match(/^((?:Vice\s+President|President|Director|Manager|Engineer|Developer|Consultant|Analyst|Architect|Specialist|Executive|Officer|Coordinator|Administrator|Trainee|Intern)(?:\s*\([^)]*\))?)\s*(-.*)?$/i);
        if (rolePartMatch) {
          const mergedRole = `${line} ${nextLine}`;
          merged.push(mergedRole);
          i = nextIdx + 1;
          continue;
        }
      }
    }

    // --- Rule 3: False headings followed by continuation text ---
    // e.g. "LANGUAGES" followed by "including HTML5, CSS3..." is NOT a real heading
    // It's mid-sentence: "...numerous programming LANGUAGES including HTML5..."
    if (/^[A-Z]{4,}$/.test(line) && line.length <= 20) {
      let nextIdx = i + 1;
      while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;
      if (nextIdx < lines.length) {
        const nextLine = lines[nextIdx].trim();
        if (CONTINUATION_WORDS_RE.test(nextLine)) {
          // Check if previous non-empty line ends without a sentence terminator
          let prevIdx = merged.length - 1;
          while (prevIdx >= 0 && !merged[prevIdx].trim()) prevIdx--;
          if (prevIdx >= 0) {
            const prevLine = merged[prevIdx].trim();
            if (prevLine && /[a-z]$/.test(prevLine)) {
              // Merge: previous line + this "heading" + continuation
              merged[prevIdx] = `${prevLine} ${line.toLowerCase()} ${nextLine}`;
              i = nextIdx + 1;
              continue;
            }
          }
        }
      }
    }

    // --- Rule 4: Ensure "Technologies" lines don't eat next role ---
    // "Technologies- HTML, CSS, JavaScript, ReactJS" should stay as-is
    // but NOT merge with the next line
    if (/^Technologies\s*[-:]/i.test(line)) {
      merged.push(line);
      i++;
      continue;
    }

    merged.push(line);
    i++;
  }

  return merged.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Fix multi-column PDF layout issues.
 *
 * Multi-column resumes (e.g. skills sidebar + main content) produce garbled
 * text when extracted by pdf-parse.  Common symptoms:
 *   - "SOFT SKILLS" / "TECHNICAL SKILLS" headings appear before the name
 *   - Individual skill words (HTML5, CSS3, ReactJS…) land inside WORK EXPERIENCE
 *   - Dates end up at page boundaries (in PROJECTS or after highlights)
 *   - Experience entries leak into the EDUCATION section after a page break
 */
function fixMultiColumnPdfLayout(text: string): string {
  const lines = text.split('\n');

  const SKILL_HEADING_RE = /^(SOFT\s+SKILLS?|TECHNICAL\s+SKILLS?|KEY\s+SKILLS?|CORE\s+SKILLS?)$/i;
  const EXP_HEADING_RE = /^(WORK\s+EXPERIENCE|PROFESSIONAL\s+EXPERIENCE|EMPLOYMENT\s+HISTORY|EXPERIENCE)$/i;
  const SUMMARY_HEADING_RE = /^(PROFESSIONAL\s+SUMMARY|SUMMARY|PROFILE\s+SUMMARY|CAREER\s+SUMMARY|CAREER\s+OBJECTIVE)$/i;
  const EDUCATION_HEADING_RE = /^(EDUCATION|ACADEMIC\s+BACKGROUND|EDUCATIONAL\s+QUALIFICATIONS?)$/i;
  const DATE_LINE_RE = /^\(?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*(?:-|to|–|—)\s*(?:Present|Current|Now|\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4})\)?$/i;
  const MM_YYYY_DATE_LINE_RE = /^\(?\d{1,2}[/-]\d{4}\s*(?:-|to|–|—)\s*(?:Present|Current|Now|\d{1,2}[/-]\d{4})\)?$/i;
  const PAGE_FOOTER_RE = /^-*\s*\d+\s+of\s+\d+\s*-*$/i;
  const ROLE_HINT_RE = /\b(AVP|Senior|Junior|Lead|Associate|Principal|Staff|Chief|Vice\s+President|Assistant\s+Vice|Manager|Director|Engineer|Developer|Consultant|Analyst|Architect|Specialist|Executive|Officer|President|Intern|Head|Founder)\b/i;
  const DEGREE_RE = /\b(b\.?e|b\.?a|b\.?s|b\.?tech|m\.?e|m\.?a|m\.?s|m\.?tech|m\.?b\.?a|bachelor|master|associate|diploma|phd|high\s+school)\b/i;

  function isDateLine(line: string) {
    const t = line.trim();
    return DATE_LINE_RE.test(t) || MM_YYYY_DATE_LINE_RE.test(t);
  }

  // --- Detect multi-column pattern ---
  let earlySkillHeadingIdx = -1;
  let nonEmptyCount = 0;
  for (let i = 0; i < lines.length && nonEmptyCount < 5; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    nonEmptyCount++;
    if (SKILL_HEADING_RE.test(trimmed)) { earlySkillHeadingIdx = i; break; }
  }

  const expHeadingIdx = lines.findIndex((l) => EXP_HEADING_RE.test(l.trim()));
  if (earlySkillHeadingIdx < 0 || expHeadingIdx < 0) return text;

  // --- Step 1: Move header/contact lines to the top, remove empty skill headings ---
  const summaryIdx = lines.findIndex((l) => SUMMARY_HEADING_RE.test(l.trim()));
  const headerEnd = summaryIdx >= 0 ? summaryIdx : expHeadingIdx;

  const headerLines: string[] = [];
  for (let i = earlySkillHeadingIdx; i < headerEnd; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (SKILL_HEADING_RE.test(trimmed)) { lines[i] = ''; continue; } // Remove empty skill headings
    const isContact = /^(Mobile|Phone|Email|E-mail|Address|Date of Birth|DOB|LinkedIn|GitHub|Website)\s*:?/i.test(trimmed);
    const isUrl = /^https?:\/\//i.test(trimmed);
    const isPipeSeparated = /\|/.test(trimmed) && trimmed.length < 120;
    const isNameLike = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}$/.test(trimmed) && trimmed.length < 40;
    const isLongParagraph = trimmed.length > 80 && /[a-z]/.test(trimmed);
    if (isContact || isUrl || isPipeSeparated || isNameLike || isLongParagraph) {
      headerLines.push(trimmed);
      lines[i] = '';
    }
  }

  if (headerLines.length > 0) {
    lines.splice(0, 0, ...headerLines, '');
  }

  // --- Step 2: Extract sidebar skill words from the experience section ---
  const newExpIdx = lines.findIndex((l) => EXP_HEADING_RE.test(l.trim()));
  if (newExpIdx < 0) return lines.join('\n');

  const sidebarSkills: string[] = [];
  for (let i = newExpIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (detectHeading(trimmed.toLowerCase())) break;
    if (ROLE_HINT_RE.test(trimmed)) break;
    if (isDateLine(trimmed)) break;
    if (trimmed.startsWith('-')) break;
    if (trimmed.length > 30) break;
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length <= 3 && /^[A-Za-z]/.test(trimmed)) {
      sidebarSkills.push(trimmed);
      lines[i] = '';
    } else {
      break;
    }
  }

  if (sidebarSkills.length > 0) {
    const skillsSection = ['', 'SKILLS', sidebarSkills.join(', '), ''];
    const insertAt = lines.findIndex((l) => EXP_HEADING_RE.test(l.trim()));
    if (insertAt >= 0) lines.splice(insertAt, 0, ...skillsSection);
  }

  // --- Step 3: Remove page footers ---
  for (let i = 0; i < lines.length; i++) {
    if (PAGE_FOOTER_RE.test(lines[i].trim())) lines[i] = '';
  }

  // --- Step 4: Move experience entries from EDUCATION back to EXPERIENCE ---
  // Also collect orphaned dates from ALL non-experience sections
  const eduIdx = lines.findIndex((l) => EDUCATION_HEADING_RE.test(l.trim()));
  const expLastIdx = lines.findIndex((l) => EXP_HEADING_RE.test(l.trim()));
  if (eduIdx >= 0 && expLastIdx >= 0) {
    const expFromEdu: string[] = [];
    let collectingExp = false;
    for (let i = eduIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // Stop at non-education, non-experience headings
      if (trimmed && detectHeading(trimmed.toLowerCase()) && !EXP_HEADING_RE.test(trimmed) && !EDUCATION_HEADING_RE.test(trimmed)) {
        if (collectingExp) { expFromEdu.push(lines[i]); lines[i] = ''; }
        break;
      }
      // Second EXPERIENCE heading = continuation from page break
      if (EXP_HEADING_RE.test(trimmed)) {
        collectingExp = true;
        lines[i] = '';
        continue;
      }
      if (!trimmed) {
        if (collectingExp) { expFromEdu.push(''); lines[i] = ''; }
        continue;
      }
      // Detect role that's NOT a degree/institution → experience entry leaked into education
      if (ROLE_HINT_RE.test(trimmed) && trimmed.length < 60 && !trimmed.startsWith('-') && !DEGREE_RE.test(trimmed)) {
        collectingExp = true;
      }
      if (collectingExp) {
        expFromEdu.push(lines[i]);
        lines[i] = '';
      }
    }

    // Insert moved experience entries right before EDUCATION
    if (expFromEdu.length > 0) {
      const eduNewIdx = lines.findIndex((l) => EDUCATION_HEADING_RE.test(l.trim()));
      if (eduNewIdx >= 0) {
        lines.splice(eduNewIdx, 0, ...expFromEdu, '');
      }
    }
  }

  // --- Step 5: Collect ALL orphaned dates and associate with undated experience entries ---
  // Rebuild section tracking after mutations
  const finalLines = lines;
  const allOrphaned: Array<{ idx: number; value: string }> = [];
  const allRoles: Array<{ idx: number; hasDate: boolean }> = [];
  let inExp = false;
  for (let i = 0; i < finalLines.length; i++) {
    const t = finalLines[i].trim();
    if (EXP_HEADING_RE.test(t)) { inExp = true; continue; }
    if (t && detectHeading(t.toLowerCase()) && !EXP_HEADING_RE.test(t)) { inExp = false; }
    if (!t) continue;

    if (inExp && ROLE_HINT_RE.test(t) && t.length < 60 && !t.startsWith('-')) {
      let hasDate = false;
      for (let j = i + 1; j < Math.min(i + 4, finalLines.length); j++) {
        if (isDateLine(finalLines[j])) { hasDate = true; break; }
      }
      allRoles.push({ idx: i, hasDate });
    }

    // Orphaned dates = date lines in non-experience sections, or date lines
    // in experience that don't follow a role within 3 lines
    if (isDateLine(t)) {
      let followsRole = false;
      for (let j = Math.max(0, i - 3); j < i; j++) {
        const prev = finalLines[j].trim();
        if (ROLE_HINT_RE.test(prev) && prev.length < 60 && !prev.startsWith('-')) {
          followsRole = true;
          break;
        }
      }
      if (!followsRole) {
        allOrphaned.push({ idx: i, value: t });
      }
    }
  }

  const undated = allRoles.filter((r) => !r.hasDate);
  for (let d = 0; d < Math.min(allOrphaned.length, undated.length); d++) {
    const role = undated[d];
    const date = allOrphaned[d];
    // Find company line (first non-empty line after role)
    let companyIdx = role.idx + 1;
    for (let j = role.idx + 1; j < finalLines.length; j++) {
      if (finalLines[j].trim()) { companyIdx = j; break; }
    }
    // Insert date right after company
    finalLines.splice(companyIdx + 1, 0, date.value);
    // Remove original orphaned date
    const origIdx = date.idx + (companyIdx + 1 <= date.idx ? 1 : 0);
    if (origIdx < finalLines.length) finalLines[origIdx] = '';
    // Adjust subsequent indices
    for (let k = d + 1; k < allOrphaned.length; k++) {
      if (allOrphaned[k].idx > companyIdx) allOrphaned[k].idx++;
    }
    for (let k = d + 1; k < undated.length; k++) {
      if (undated[k].idx > companyIdx) undated[k].idx++;
    }
  }

  return finalLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLegacyBulletPrefix(line: string) {
  const raw = String(line || '');
  if (!LEGACY_BULLET_PREFIX_RE.test(raw)) return raw;
  const stripped = raw.replace(LEGACY_BULLET_PREFIX_RE, '').trim();
  if (!stripped) return '';
  return `- ${stripped}`;
}

function mapResumeSections(text: string) {
  const lines = text.split(/\n/).map((l) => normalizeLegacyBulletPrefix(l).trim()).filter(Boolean);
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

  for (const rawLine of lines) {
    const line = normalizeLegacyBulletPrefix(rawLine).trim();
    if (!line) continue;
    if (looksLikeExperienceHeader(line)) {
      if (current && hasMeaningfulExperience(current)) blocks.push(current);
      current = buildExperienceHeader(line);
      continue;
    }

    if (isDateLine(line) && current && (current.company || current.role) && (!current.startDate && !current.endDate)) {
      const dates = extractDates(line);
      current.startDate = dates.start || current.startDate;
      current.endDate = dates.end || current.endDate;
      continue;
    }

    if (!current) continue;

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
  const normalizedLine = normalizeLegacyBulletPrefix(String(line || '')).trim();
  if (!normalizedLine || normalizedLine.startsWith('-')) return false;
  if (detectHeading(normalizedLine.toLowerCase())) return false;

  const hasDate = isDateLine(normalizedLine);
  const hasRole = looksLikeRoleCompany(normalizedLine);
  const hasCompany = looksLikeCompany(normalizedLine);
  const split = splitRoleCompany(stripDates(normalizedLine));
  const hasRoleCompanyPattern = Boolean(split.role.trim() && split.company.trim());

  if (hasDate) {
    // Date lines become new experience entries only with nearby role/company context.
    return hasRoleCompanyPattern || (hasRole && hasCompany);
  }
  return hasRoleCompanyPattern || (hasRole && hasCompany);
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
type PdfTheme = {
  fontFamily?: string;
  spacing?: 'compact' | 'normal' | 'airy';
  accent?: string;
};

type RenderResumeHtmlInput = {
  templateId?: string | null;
  resumeData: any;
  theme?: PdfTheme;
};

type RenderContext = 'preview' | 'export';

type RenderResumeTemplateHtmlInput = {
  templateId?: string | null;
  resumeData: any;
  mode: RenderContext;
};

type RenderResumeTemplateHtmlOutput = {
  html: string;
  fingerprint: string;
  cssBundle: string;
  cssIncluded: boolean;
};

type TemplateExperienceItem = {
  role: string;
  company: string;
  startDate: string;
  endDate: string;
  highlights: string[];
};

type TemplateEducationItem = {
  degree: string;
  institution: string;
  startDate?: string;
  endDate?: string;
};

type TemplateProjectItem = {
  name: string;
  startDate: string;
  endDate: string;
  highlights: string[];
};

type TemplateCertificationItem = {
  name: string;
  issuer: string;
  date: string;
};

const ATS_TEMPLATE_EXPORT_CSS_BUNDLE = 'inline:ats-template-css-v1';
const ATS_TEMPLATE_EXPORT_CSS = `
      @page { size: A4; margin: 15mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        font-family: Arial, "Helvetica Neue", Helvetica, "Inter", sans-serif;
        color: #111;
        background: #ffffff;
        font-size: 11px;
        line-height: 1.32;
      }
      .resume-export-root {
        width: 100%;
      }
      .resume-export-page {
        width: 100%;
      }
      .sr-only-fingerprint {
        display: none !important;
      }
      .ats-template {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #d9e2ec;
        background: #fff;
        padding: 18px 20px;
        color: #111;
        font-size: 11px;
        line-height: 1.32;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .ats-template--technical {
        padding-top: 16px;
        padding-bottom: 16px;
      }
      .ats-template__header {
        border-bottom: 2px solid #111;
        padding-bottom: 7px;
        margin-bottom: 12px;
      }
      .ats-template__header h1 {
        margin: 0;
        font-size: 21px;
        line-height: 1.15;
        font-weight: 700;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .ats-template--executive .ats-template__header h1 {
        font-size: 24px;
        letter-spacing: 0.3px;
      }
      .ats-template__header p {
        margin: 4px 0 0;
        color: #39495e;
        font-size: 10.6px;
        overflow-wrap: anywhere;
        word-break: break-word;
        white-space: normal;
      }
      .ats-template__header--bar {
        border-bottom-color: #2b3a55;
        border-bottom-width: 3px;
      }
      .ats-section {
        margin-top: 12px;
        break-inside: auto;
        page-break-inside: auto;
      }
      .ats-section--tight {
        margin-top: 8px;
      }
      .ats-section--divided {
        border-bottom: 1px solid #dce5ef;
        padding-bottom: 8px;
      }
      .ats-section h2 {
        margin: 0 0 6px;
        font-size: 12.5px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #1b2b3c;
      }
      .ats-section h2.ats-upper {
        letter-spacing: 0.12em;
      }
      .ats-section p {
        margin: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .ats-item {
        margin-top: 8px;
        page-break-inside: avoid;
      }
      .ats-item h3 {
        margin: 0;
        font-size: 11.2px;
        font-weight: 700;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .ats-item p {
        margin: 2px 0 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .ats-item__meta {
        color: #4b5d74;
        font-size: 10.4px;
      }
      .ats-item ul {
        margin: 5px 0 0 18px;
        padding: 0;
      }
      .ats-item li {
        margin: 2px 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
`;

export function renderResumeTemplateHtml(input: RenderResumeTemplateHtmlInput): RenderResumeTemplateHtmlOutput {
  const resume = input?.resumeData || {};
  const templateId = resolveExportTemplateId(input?.templateId, resume?.templateId);
  const fingerprint = `TEMPLATE_FINGERPRINT:${templateId}`;
  const title = escapeHtml(templateFullNameOrTitle(resume));
  const body = renderTemplateBody(templateId, resume);
  const mode = input.mode;
  const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>${ATS_TEMPLATE_EXPORT_CSS}</style>
  </head>
  <body>
    <div class="resume-export-root" data-template-id="${safeCssClass(templateId)}" data-render-context="${mode}" data-css-bundle="${ATS_TEMPLATE_EXPORT_CSS_BUNDLE}">
      <span class="sr-only-fingerprint">${fingerprint}</span>
      <main class="resume-export-page">
        ${body}
      </main>
    </div>
  </body>
</html>
`;
  return {
    html,
    fingerprint,
    cssBundle: ATS_TEMPLATE_EXPORT_CSS_BUNDLE,
    cssIncluded: true,
  };
}

export function renderResumeHtml(input: RenderResumeHtmlInput): string {
  return renderResumeTemplateHtml({
    templateId: input.templateId,
    resumeData: input.resumeData,
    mode: 'export',
  }).html;
}

function renderTemplateBody(templateId: string, resume: any) {
  if (templateId === 'modern') return renderModernTemplateArticle(resume);
  if (templateId === 'executive') return renderExecutiveTemplateArticle(resume);
  if (templateId === 'technical') return renderTechnicalTemplateArticle(resume);
  if (templateId === 'consultant') return renderConsultantTemplateArticle(resume);
  if (['minimal', 'graduate'].includes(templateId)) return renderMinimalTemplateArticle(resume);
  return renderClassicTemplateArticle(resume);
}

function renderClassicTemplateArticle(resume: any) {
  const normalized = normalizeTemplateResumeData(resume);
  return `
    <article class="ats-template ats-template--classic">
      ${templateHeader(normalized)}
      ${renderOrderedSections(normalized, { companyJoiner: ', ', uppercaseHeadings: true })}
    </article>
  `;
}

function renderModernTemplateArticle(resume: any) {
  const normalized = normalizeTemplateResumeData(resume);
  return `
    <article class="ats-template ats-template--modern">
      ${templateHeader(normalized, { bar: true })}
      ${renderOrderedSections(normalized, { companyJoiner: ' | ', divided: true })}
    </article>
  `;
}

function renderExecutiveTemplateArticle(resume: any) {
  const normalized = normalizeTemplateResumeData(resume);
  return `
    <article class="ats-template ats-template--executive">
      ${templateHeader(normalized, { executive: true })}
      ${renderOrderedSections(normalized, { companyJoiner: ', ', upperClassHeadings: true })}
    </article>
  `;
}

function renderTechnicalTemplateArticle(resume: any) {
  const normalized = normalizeTemplateResumeData(resume);
  const groupedSkills = buildGroupedSkillLine(normalized);
  return `
    <article class="ats-template ats-template--technical">
      ${templateHeader(normalized)}
      ${renderOrderedSections(normalized, { companyJoiner: ' @ ', tight: true, groupedSkillLine: groupedSkills })}
    </article>
  `;
}

function renderMinimalTemplateArticle(resume: any) {
  const normalized = normalizeTemplateResumeData(resume);
  return `
    <article class="ats-template ats-template--minimal">
      ${templateHeader(normalized)}
      ${renderOrderedSections(normalized, { companyJoiner: ', ' })}
    </article>
  `;
}

function renderConsultantTemplateArticle(resume: any) {
  const normalized = normalizeTemplateResumeData(resume);
  return `
    <article class="ats-template ats-template--consultant">
      ${templateHeader(normalized, { bar: true })}
      ${renderOrderedSections(normalized, { companyJoiner: ' | ', divided: true })}
    </article>
  `;
}

function templateHeader(resume: any, options?: { bar?: boolean; executive?: boolean }) {
  const classes = ['ats-template__header'];
  if (options?.bar) classes.push('ats-template__header--bar');
  if (options?.executive) classes.push('ats-template__header--executive');
  const line = templateContactLine(resume);
  return `
      <header class="${classes.join(' ')}">
        <h1>${escapeHtml(templateFullNameOrTitle(resume))}</h1>
        ${line ? `<p>${escapeHtml(line)}</p>` : ''}
      </header>
  `;
}

function renderOrderedSections(
  resume: any,
  options: {
    companyJoiner: ', ' | ' | ' | ' @ ';
    tight?: boolean;
    divided?: boolean;
    uppercaseHeadings?: boolean;
    upperClassHeadings?: boolean;
    groupedSkillLine?: string;
  },
) {
  const summary = escapeHtml(String(resume.summary || '').trim() || 'Add a concise summary aligned to your target role.');
  const skills = templateCleanList(resume.skills);
  const technicalSkills = templateCleanList(resume.technicalSkills);
  const softSkills = templateCleanList(resume.softSkills);
  const mergedSkills = dedupeSkills([...skills, ...technicalSkills, ...softSkills]);
  const languages = templateCleanList(resume.languages);
  const experience = templateExperienceItems(resume);
  const projects = templateProjectItems(resume);
  const education = templateEducationItems(resume);
  const certifications = templateCertificationItems(resume);
  const sectionClass = `ats-section${options.tight ? ' ats-section--tight' : ''}${options.divided ? ' ats-section--divided' : ''}`;

  const heading = (label: string) => {
    const transformed = options.uppercaseHeadings || options.upperClassHeadings ? label.toUpperCase() : label;
    const classAttr = options.upperClassHeadings ? ' class="ats-upper"' : '';
    return `<h2${classAttr}>${transformed}</h2>`;
  };

  const skillLine = options.groupedSkillLine || (mergedSkills.length ? mergedSkills.join(', ') : 'Add role-relevant skills.');
  const sections: string[] = [];

  sections.push(`
      <section class="${sectionClass}">
        ${heading('Summary')}
        <p>${summary}</p>
      </section>
  `);

  sections.push(`
      <section class="${sectionClass}">
        ${heading('Skills')}
        <p>${escapeHtml(skillLine)}</p>
      </section>
  `);

  sections.push(`
      <section class="${sectionClass}">
        ${heading('Experience')}
        ${experience.length ? experience.map((item: TemplateExperienceItem) => renderRoleBlock(item, options.companyJoiner)).join('') : '<p>No experience added.</p>'}
      </section>
  `);

  if (projects.length) {
    sections.push(`
      <section class="${sectionClass}">
        ${heading('Projects')}
        ${projects.map((item: TemplateProjectItem) => renderProjectBlock(item)).join('')}
      </section>
    `);
  }

  sections.push(`
      <section class="${sectionClass}">
        ${heading('Education')}
        ${education.length ? education.map((item: TemplateEducationItem) => renderEducationBlock(item)).join('') : '<p>No education added.</p>'}
      </section>
  `);

  if (certifications.length) {
    sections.push(`
      <section class="${sectionClass}">
        ${heading('Certifications')}
        ${certifications.map((item: TemplateCertificationItem) => renderCertificationBlock(item)).join('')}
      </section>
    `);
  }

  if (languages.length) {
    sections.push(`
      <section class="${sectionClass}">
        ${heading('Languages')}
        <p>${escapeHtml(languages.join(', '))}</p>
      </section>
    `);
  }

  return sections.join('');
}

function renderRoleBlock(
  item: { role: string; company: string; startDate: string; endDate: string; highlights: string[] },
  companyJoiner: ', ' | ' | ' | ' @ ',
) {
  const heading = `${item.role || 'Role'}${item.company ? `${companyJoiner}${item.company}` : ''}`;
  const lines = templateCleanList(item.highlights);
  const dateLine = templateDateRange(item.startDate, item.endDate);
  return `
        <div class="ats-item">
          <h3>${escapeHtml(heading)}</h3>
          ${dateLine ? `<p class="ats-item__meta">${escapeHtml(dateLine)}</p>` : ''}
          <ul>
            ${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
          </ul>
        </div>
  `;
}

function renderEducationBlock(item: { degree: string; institution: string; startDate?: string; endDate?: string }) {
  const dateLine = templateDateRange(String(item.startDate || ''), String(item.endDate || ''));
  return `
        <div class="ats-item">
          <h3>${escapeHtml(item.degree || 'Degree')}</h3>
          <p>${escapeHtml(item.institution || '')}</p>
          ${dateLine ? `<p class="ats-item__meta">${escapeHtml(dateLine)}</p>` : ''}
        </div>
  `;
}

function renderProjectBlock(item: { name: string; startDate: string; endDate: string; highlights: string[] }) {
  const lines = templateCleanList(item.highlights);
  const dateLine = templateDateRange(item.startDate, item.endDate);
  return `
        <div class="ats-item">
          <h3>${escapeHtml(item.name || 'Project')}</h3>
          ${dateLine ? `<p class="ats-item__meta">${escapeHtml(dateLine)}</p>` : ''}
          <ul>
            ${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
          </ul>
        </div>
  `;
}

function renderCertificationBlock(item: TemplateCertificationItem) {
  const meta = [item.issuer, templateDateRange(item.date, '')].filter(Boolean).join(' | ');
  return `
        <div class="ats-item">
          <h3>${escapeHtml(item.name || 'Certification')}</h3>
          ${meta ? `<p>${escapeHtml(meta)}</p>` : ''}
        </div>
  `;
}

function templateCleanList(input: unknown) {
  if (!Array.isArray(input)) return [] as string[];
  return uniqueLines(
    input
      .map((item) => sanitizeBulletForAts(String(item || '')))
      .filter(Boolean),
  );
}

function templateFullNameOrTitle(resume: any) {
  const fullName = String(resume?.contact?.fullName || '').trim();
  const title = String(resume?.title || '').trim();
  // Prefer fullName for the h1 heading so that pdf-parse can recover the
  // person's name during ATS PDF round-trip (re-uploading an exported PDF).
  // Fall back to title if fullName is not available.
  return fullName || title || 'Resume';
}

function templateContactLine(resume: any) {
  const parts = [
    resume?.contact?.email,
    resume?.contact?.phone,
    resume?.contact?.location,
    ...(Array.isArray(resume?.contact?.links) ? resume.contact.links : []),
  ].map((item) => String(item || '').trim()).filter(Boolean);
  return parts.join(' | ');
}

function templateExperienceItems(resume: any) {
  const items = Array.isArray(resume?.experience) ? (resume.experience as Array<Record<string, unknown>>) : [];
  return sortExperienceChronological(items
    .map((item: Record<string, unknown>): TemplateExperienceItem => ({
      role: String(item?.role || '').trim(),
      company: String(item?.company || '').trim(),
      startDate: normalizeExportDateToken(String(item?.startDate || ''), false),
      endDate: normalizeExportDateToken(String(item?.endDate || ''), true),
      highlights: sanitizeBulletList(item?.highlights),
    }))
    .filter((item: TemplateExperienceItem) => Boolean(item.role || item.company || item.highlights.length)));
}

function templateEducationItems(resume: any) {
  const items = Array.isArray(resume?.education) ? (resume.education as Array<Record<string, unknown>>) : [];
  return items
    .map((item: Record<string, unknown>): TemplateEducationItem => ({
      degree: String(item?.degree || '').trim(),
      institution: String(item?.institution || '').trim(),
      startDate: normalizeExportDateToken(String(item?.startDate || ''), false),
      endDate: normalizeExportDateToken(String(item?.endDate || ''), false),
    }))
    .filter((item: TemplateEducationItem) => Boolean(item.degree || item.institution));
}

function templateProjectItems(resume: any) {
  const items = Array.isArray(resume?.projects) ? (resume.projects as Array<Record<string, unknown>>) : [];
  return items
    .map((item: Record<string, unknown>): TemplateProjectItem => ({
      name: String(item?.name || '').trim(),
      startDate: normalizeExportDateToken(String(item?.startDate || ''), false),
      endDate: normalizeExportDateToken(String(item?.endDate || ''), false),
      highlights: sanitizeBulletList(item?.highlights),
    }))
    .filter((item: TemplateProjectItem) => Boolean(item.name || item.highlights.length));
}

function templateCertificationItems(resume: any) {
  const items = Array.isArray(resume?.certifications) ? (resume.certifications as Array<Record<string, unknown>>) : [];
  return items
    .map((item: Record<string, unknown>): TemplateCertificationItem => ({
      name: String(item?.name || '').trim(),
      issuer: String(item?.issuer || '').trim(),
      date: normalizeExportDateToken(String(item?.date || ''), false),
    }))
    .filter((item: TemplateCertificationItem) => Boolean(item.name));
}

function normalizeTemplateResumeData(resume: any) {
  const normalized = {
    ...resume,
    summary: String(resume?.summary || '').replace(/\s+/g, ' ').trim(),
    skills: dedupeSkills(templateCleanList(resume?.skills)),
    technicalSkills: dedupeSkills(templateCleanList(resume?.technicalSkills)),
    softSkills: dedupeSkills(templateCleanList(resume?.softSkills)),
    languages: dedupeLanguages(templateCleanList(resume?.languages)),
    experience: templateExperienceItems(resume),
    projects: templateProjectItems(resume),
    education: templateEducationItems(resume),
    certifications: templateCertificationItems(resume),
  };
  return normalized;
}

function buildGroupedSkillLine(resume: any) {
  const technicalSkills = templateCleanList(resume?.technicalSkills);
  const softSkills = templateCleanList(resume?.softSkills);
  const skills = templateCleanList(resume?.skills);
  return [
    technicalSkills.length ? `Technical: ${technicalSkills.join(', ')}` : '',
    softSkills.length ? `Soft: ${softSkills.join(', ')}` : '',
    skills.length ? `General: ${skills.join(', ')}` : '',
  ].filter(Boolean).join(' | ');
}

function sanitizeBulletList(input: unknown) {
  if (!Array.isArray(input)) return [] as string[];
  return uniqueLines(
    input
      .map((line) => sanitizeBulletForAts(String(line || '')))
      .filter(Boolean),
  );
}

function sanitizeBulletForAts(value: string) {
  const cleaned = normalizeBulletText(String(value || ''))
    .replace(/^\s*[-:;|]+\s*/, '')
    .replace(/\s*[-:;|]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

function templateDateRange(startDate: string, endDate: string) {
  const start = formatExportDateToken(startDate);
  const end = formatExportDateToken(endDate);
  if (start && end) return `${start} - ${end}`;
  if (start) return start;
  if (end) return end;
  return '';
}

function formatExportDateToken(token: string) {
  const normalized = normalizeExportDateToken(token, true);
  if (!normalized) return '';
  if (normalized === 'Present') return 'Present';
  const match = normalized.match(/^(19\d{2}|20\d{2})-(0[1-9]|1[0-2])$/);
  if (!match) return '';
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIndex = Number(match[2]) - 1;
  return `${monthLabels[monthIndex]} ${match[1]}`;
}

function normalizeExportDateToken(token: string, allowPresent: boolean) {
  const raw = String(token || '').trim();
  if (!raw || /^[-_/.,\s|]+$/.test(raw)) return '';
  if (allowPresent && /^(present|current|now)$/i.test(raw)) return 'Present';
  const normalized = toYearMonthToken(raw);
  return normalized || '';
}

function normalizeTemplateId(value: unknown) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'classic';
  const aliases: Record<string, string> = {
    student: 'minimal',
    graduate: 'graduate',
    senior: 'executive',
    portfolio: 'executive',
    product: 'modern',
    'modern-professional': 'modern',
    'classic-ats': 'classic',
    'executive-impact': 'executive',
    'technical-compact': 'technical',
    'graduate-starter': 'graduate',
    'minimal-clean': 'minimal',
    'consultant-clean': 'consultant',
  };
  const normalized = aliases[raw] || raw;
  if (['classic', 'modern', 'executive', 'technical', 'minimal', 'consultant', 'graduate'].includes(normalized)) {
    return normalized;
  }
  return 'classic';
}

function resolveExportTemplateId(templateIdOverride: unknown, resumeTemplateId: unknown) {
  const explicitTemplateId = String(templateIdOverride || '').trim();
  if (explicitTemplateId) return normalizeTemplateId(explicitTemplateId);
  const storedTemplateId = String(resumeTemplateId || '').trim();
  if (storedTemplateId) return normalizeTemplateId(storedTemplateId);
  return 'classic';
}

function isSingleColumnAtsTemplate(templateId: string) {
  return ['classic', 'modern', 'executive', 'technical', 'minimal', 'consultant', 'graduate'].includes(templateId);
}

function resolveTemplateFlavor(templateId: string): 'classic' | 'modern' | 'executive' | 'technical' | 'minimal' | 'consultant' {
  if (templateId === 'modern') return 'modern';
  if (templateId === 'consultant') return 'consultant';
  if (['executive', 'senior', 'portfolio'].includes(templateId)) return 'executive';
  if (templateId === 'technical') return 'technical';
  if (['minimal', 'graduate', 'student'].includes(templateId)) return 'minimal';
  return 'classic';
}

function resolveTemplateLayout(templateId: string): 'single' | 'two-column' | 'timeline' {
  if (templateId === 'modern-timeline') return 'timeline';
  if (['student', 'product', 'modern-two-column', 'accent-sidebar'].includes(templateId)) {
    return 'two-column';
  }
  return 'single';
}

function resolveTemplateAccent(templateId: string) {
  const palette: Record<string, string> = {
    classic: '#111111',
    modern: '#2b3a55',
    student: '#2f7a5d',
    senior: '#1f3a5f',
    executive: '#1f3a5f',
    graduate: '#2f7a5d',
    minimal: '#111111',
    consultant: '#2b3a55',
    product: '#2b3a55',
    portfolio: '#7a3e20',
    technical: '#111111',
    'modern-two-column': '#1f3a63',
    'modern-timeline': '#2f5f9b',
    'clean-classic': '#111111',
    'accent-sidebar': '#2f7a5d',
    'bold-headers': '#1f3a63',
  };
  return palette[templateId] || '#111111';
}

function resolveTemplateFont(templateId: string) {
  const families: Record<string, string> = {
    senior: '"Georgia", "Times New Roman", serif',
    executive: '"Georgia", "Times New Roman", serif',
    portfolio: '"Georgia", "Times New Roman", serif',
    modern: '"Source Sans 3", "Segoe UI", Arial, sans-serif',
    technical: '"IBM Plex Sans", "Segoe UI", Arial, sans-serif',
    graduate: '"Work Sans", "Segoe UI", Arial, sans-serif',
    minimal: '"IBM Plex Sans", "Segoe UI", Arial, sans-serif',
    consultant: '"IBM Plex Sans", "Segoe UI", Arial, sans-serif',
    default: '"IBM Plex Sans", "Segoe UI", Arial, sans-serif',
  };
  return families[templateId] || families.default;
}

function resolveTemplateSpacing(spacing: PdfTheme['spacing']) {
  if (spacing === 'compact' || spacing === 'airy' || spacing === 'normal') return spacing;
  return 'normal';
}

function safeCssClass(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
}

function logExportRenderMeta(input: {
  resumeId: string;
  templateId: string;
  cssIncluded: boolean;
  renderer: string;
}) {
  if (process.env.NODE_ENV === 'production') return;
  console.info(
    `[resume-export] resumeId=${input.resumeId} templateId=${input.templateId} cssIncluded=${input.cssIncluded ? 'true' : 'false'} renderer=${input.renderer}`,
  );
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
  const targetRoleAnalysis = analyzeTargetRoleSignals(jdText, input.resumeText);
  const suggestionMissingKeywords = missingKeywords.filter((keyword) => !targetRoleAnalysis.missingTargetRoleTokens.has(keyword.toLowerCase()));

  const rejectionReasons: string[] = [];
  if (!input.sections.experience) rejectionReasons.push('Missing Experience section.');
  if (!input.sections.skills) rejectionReasons.push('Missing Skills section (minimum 3 skills).');
  if (!input.sections.education) rejectionReasons.push('Missing Education section.');
  if (bulletQuality.tooLongCount > 0) rejectionReasons.push('Bullets exceed recommended length.');
  if (actionVerbScore < ACTION_VERB_REQUIRED_RATIO) {
    rejectionReasons.push(bulletQuality.actionVerbRule.message);
  }

  const improvementSuggestions = buildSuggestions({
    missingKeywords: suggestionMissingKeywords,
    missingTargetRoleSignals: targetRoleAnalysis.missingTargetRoleSignals,
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
  missingTargetRoleSignals: string[];
  sections: { summary: boolean; experience: boolean; education: boolean; skills: boolean };
  jdProvided: boolean;
  bulletQuality: { actionVerbRatio: number; densityScore: number; tooLongCount: number; actionVerbRule?: { message?: string } };
}): string[] {
  const suggestions: string[] = [];
  if (input.missingTargetRoleSignals.length) {
    suggestions.push(`Missing target-role signals: ${input.missingTargetRoleSignals.slice(0, 4).join(', ')}.`);
  }
  if (input.missingKeywords.length) {
    suggestions.push(`Show these target keywords in your Summary, Experience, or Skills: ${input.missingKeywords.slice(0, 6).join(', ')}.`);
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
    suggestions.push('Paste a job description to improve ATS keyword matching.');
  }
  return suggestions.slice(0, 7);
}

const TARGET_ROLE_TITLE_REGEX =
  /\b(manager|lead|leader|director|head|supervisor|vp|vice president|president|principal|architect|engineer|developer|designer|analyst|consultant|specialist|coordinator|administrator|officer)\b/i;
const TARGET_ROLE_LEADERSHIP_TOKENS = new Set([
  'manager',
  'lead',
  'leader',
  'leadership',
  'director',
  'head',
  'supervisor',
  'vp',
  'president',
  'principal',
]);
const TARGET_ROLE_LEADERSHIP_SIGNAL_REGEX =
  /\b(led|leading|leadership|managed|managing|management|mentored|mentoring|owned|ownership|stakeholder|stakeholders|planning|planned|delivery|delivered|delegated|delegation|coordinated|coordination|supervised|supervision|roadmap|sprint|cross-functional)\b/i;

function analyzeTargetRoleSignals(jdText: string, resumeText: string) {
  const targetRoles = extractTargetRoleCandidates(jdText);
  if (!targetRoles.length) {
    return {
      targetRoles: [],
      missingTargetRoleSignals: [],
      missingTargetRoleTokens: new Set<string>(),
    };
  }

  const resumeTokens = tokenize(resumeText);
  const normalizedResumeText = normalizeWhitespace(resumeText).toLowerCase();
  const missingTargetRoleSignals = targetRoles.filter((role) =>
    isMissingTargetRoleSignal(role, normalizedResumeText, resumeTokens),
  );

  return {
    targetRoles,
    missingTargetRoleSignals,
    missingTargetRoleTokens: new Set(
      missingTargetRoleSignals.flatMap((role) => tokenizePhrase(role)),
    ),
  };
}

function extractTargetRoleCandidates(text: string) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const segments = raw
    .split(/\r?\n|[;,|]/)
    .map((item) => cleanTargetRoleCandidate(item))
    .filter(Boolean);
  if (!segments.length) return [];

  const roleCandidates = segments.filter((item) => isLikelyTargetRoleCandidate(item));
  const structuredInput = /[\r\n;,|]/.test(raw);
  const shortInput = raw.length <= 160;
  const looksLikeRoleList = roleCandidates.length > 0 && roleCandidates.length === segments.length && roleCandidates.length <= 6;

  if (!looksLikeRoleList) return [];
  if (!shortInput && !(structuredInput && roleCandidates.length >= 2)) return [];

  const deduped = new Set<string>();
  for (const role of roleCandidates) {
    deduped.add(formatTargetRoleLabel(role));
  }
  return Array.from(deduped);
}

function cleanTargetRoleCandidate(value: string) {
  return normalizeWhitespace(
    value
      .replace(/^[\s\u2022*-\d.)]+/, '')
      .replace(/^target roles?\s*:?\s*/i, '')
      .replace(/[.]+$/, ''),
  );
}

function isLikelyTargetRoleCandidate(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return false;
  return TARGET_ROLE_TITLE_REGEX.test(normalized);
}

function formatTargetRoleLabel(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function tokenizePhrase(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeWhitespace(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isMissingTargetRoleSignal(role: string, normalizedResumeText: string, resumeTokens: Set<string>) {
  const roleTokens = tokenizePhrase(role);
  if (!roleTokens.length) return false;

  const exactRoleMatch =
    roleTokens.length === 1
      ? resumeTokens.has(roleTokens[0])
      : normalizedResumeText.includes(role.toLowerCase());
  if (exactRoleMatch) return false;

  const hasAllRoleTokens = roleTokens.every((token) => resumeTokens.has(token));
  const leadershipRole = roleTokens.some((token) => TARGET_ROLE_LEADERSHIP_TOKENS.has(token));
  if (!leadershipRole) return !hasAllRoleTokens;
  if (hasAllRoleTokens) return false;

  const nonLeadershipTokens = roleTokens.filter((token) => !TARGET_ROLE_LEADERSHIP_TOKENS.has(token) && token !== 'team');
  const hasLeadershipSignals = TARGET_ROLE_LEADERSHIP_SIGNAL_REGEX.test(normalizedResumeText);
  if (!hasLeadershipSignals) return true;
  if (!nonLeadershipTokens.length) return false;
  return !nonLeadershipTokens.every((token) => resumeTokens.has(token));
}
