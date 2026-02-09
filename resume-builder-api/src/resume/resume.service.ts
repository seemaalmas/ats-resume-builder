import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import puppeteer from 'puppeteer';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateResumeDto, UpdateResumeDto } from 'resume-builder-shared';
import { ResumeSectionsSchema } from 'resume-schemas';
import { ensureUsagePeriod } from '../billing/usage';
import { rateLimitOrThrow } from '../limits/rate-limit';
import { mapParsedResume, parseResumeText } from 'resume-intelligence';

const ACTION_VERBS = new Set([
  'achieved','built','created','delivered','designed','developed','drove','executed','improved','launched','led','managed','optimized','reduced','shipped','streamlined','implemented','analyzed','automated','collaborated','increased','mentored','owned','resolved','scaled','spearheaded'
]);
const MIN_PDF_ATS_SCORE = 70;

@Injectable()
export class ResumeService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateResumeDto) {
    rateLimitOrThrow({
      key: `resume:create:${userId}`,
      limit: 10,
      windowMs: 60_000,
      message: 'Rate limit exceeded for resume creation.',
    });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.plan === 'FREE') {
      throw new ForbiddenException('Free plan does not allow resume creation.');
    }
    await ensureUsagePeriod(this.prisma, user);
    const resumeCount = await this.prisma.resume.count({ where: { userId } });
    if (resumeCount + 1 > user.resumesLimit) {
      throw new ForbiddenException('Resume limit exceeded for your plan.');
    }
    const normalized = validateResumeSectionsOrThrow({
      title: dto.title,
      contact: dto.contact ?? undefined,
      summary: dto.summary,
      skills: dto.skills ?? [],
      experience: dto.experience ?? [],
      education: dto.education ?? [],
      projects: dto.projects ?? [],
      certifications: dto.certifications ?? [],
    });
    enforceAtsResumeRules({
      summary: normalized.summary,
      skills: normalized.skills,
      experience: normalized.experience,
      education: normalized.education,
    });
    return this.prisma.resume.create({
      data: {
        userId,
        title: normalized.title,
        contact: normalized.contact ?? undefined,
        skills: normalized.skills,
        summary: normalized.summary,
        experience: normalized.experience,
        education: normalized.education,
        projects: normalized.projects ?? [],
        certifications: normalized.certifications ?? [],
      },
    });
  }

  async list(userId: string) {
    return this.prisma.resume.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(userId: string, id: string) {
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
    const current = await this.get(userId, id);
    const normalized = validateResumeSectionsOrThrow({
      title: dto.title ?? current.title,
      contact: dto.contact ?? (current.contact as Record<string, unknown> | undefined),
      summary: dto.summary ?? current.summary,
      skills: dto.skills ?? (Array.isArray(current.skills) ? current.skills : []),
      experience: dto.experience ?? (Array.isArray(current.experience) ? current.experience as any[] : []),
      education: dto.education ?? (Array.isArray(current.education) ? current.education as any[] : []),
      projects: dto.projects ?? (Array.isArray(current.projects) ? current.projects as any[] : []),
      certifications: dto.certifications ?? (Array.isArray(current.certifications) ? current.certifications as any[] : []),
    });
    enforceAtsResumeRules({
      summary: normalized.summary,
      skills: normalized.skills,
      experience: normalized.experience,
      education: normalized.education,
    });
    return this.prisma.resume.update({
      where: { id },
      data: {
        title: normalized.title,
        contact: normalized.contact ?? undefined,
        skills: normalized.skills,
        summary: normalized.summary,
        experience: normalized.experience,
        education: normalized.education,
        projects: normalized.projects,
        certifications: normalized.certifications,
      },
    });
  }

  async duplicate(userId: string, id: string, title?: string) {
    const resume = await this.get(userId, id);
    const nextTitle = title || `${resume.title} Copy`;
    const normalized = validateResumeSectionsOrThrow({
      title: nextTitle,
      contact: (resume.contact as Record<string, unknown> | undefined) ?? undefined,
      summary: resume.summary,
      skills: Array.isArray(resume.skills) ? resume.skills : [],
      experience: Array.isArray(resume.experience) ? resume.experience as any[] : [],
      education: Array.isArray(resume.education) ? resume.education as any[] : [],
      projects: Array.isArray(resume.projects) ? resume.projects as any[] : [],
      certifications: Array.isArray(resume.certifications) ? resume.certifications as any[] : [],
    });
    enforceAtsResumeRules({
      summary: normalized.summary,
      skills: normalized.skills,
      experience: normalized.experience,
      education: normalized.education,
    });
    return this.prisma.resume.create({
      data: {
        userId,
        title: normalized.title,
        contact: normalized.contact ?? undefined,
        skills: normalized.skills,
        summary: normalized.summary,
        experience: normalized.experience,
        education: normalized.education,
        projects: normalized.projects ?? [],
        certifications: normalized.certifications ?? [],
      },
    });
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
    if (user.plan === 'FREE') {
      throw new ForbiddenException('Free plan does not allow ATS scans.');
    }
    await ensureUsagePeriod(this.prisma, user);
    const refreshed = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!refreshed) {
      throw new NotFoundException('User not found');
    }
    if (refreshed.atsScansUsed + 1 > refreshed.atsScansLimit) {
      throw new ForbiddenException('ATS scan limit exceeded.');
    }
    const resume = await this.get(userId, id);
    const resumeText = buildResumeText(resume);
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
    return { resumeId: id, ...result };
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
    if (user.plan === 'FREE') {
      throw new ForbiddenException('Free plan does not allow PDF export.');
    }
    await ensureUsagePeriod(this.prisma, user);
    const updatedUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }
    if (updatedUser.pdfExportsUsed + 1 > updatedUser.pdfExportsLimit) {
      throw new ForbiddenException('PDF export limit exceeded');
    }
    const resume = await this.get(userId, id);
    validatePdfExportSafety(resume);
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
      const mapped = mapParsedResume(parsed);
      const parsedPayload = {
        title: options?.title?.trim() || mapped.title,
        contact: mapped.contact,
        summary: mapped.summary,
        skills: mapped.skills,
        experience: mapped.experience,
        education: mapped.education,
        projects: mapped.projects,
        certifications: mapped.certifications,
        roleLevel: mapped.roleLevel,
        unmappedText: mapped.unmappedText,
      };
      return {
        text: normalized,
        parsed: parsedPayload,
        ...parsedPayload,
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

function validateResumeSectionsOrThrow(input: {
  title: string;
  contact?: Record<string, unknown>;
  summary: string;
  skills: string[];
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
    experience: input.experience,
    education: input.education,
    projects: input.projects ?? [],
    certifications: input.certifications ?? [],
  });
  if (!parsed.success) {
    throw new BadRequestException({ errors: parsed.error.issues.map((issue) => issue.message) });
  }
  return parsed.data;
}

function enforceAtsResumeRules(input: {
  summary: string;
  skills: string[];
  experience: Array<{ highlights?: string[] }>;
  education: Array<{ details?: string[] }>;
}) {
  const errors: string[] = [];
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

  const experienceBullets = input.experience.flatMap((e) => Array.isArray(e.highlights) ? e.highlights : []);
  const normalized = experienceBullets.map((b) => String(b || '').trim()).filter(Boolean);
  if (normalized.length === 0) {
    errors.push('Experience must include at least one bullet highlight.');
  }
  const tooLong = normalized.filter((b) => wordCount(b) > 28);
  if (tooLong.length > 0) {
    errors.push('Experience bullets must be 28 words or fewer.');
  }
  const actionVerbRatio = normalized.length
    ? normalized.filter((b) => ACTION_VERBS.has(firstWord(b))).length / normalized.length
    : 0;
  if (actionVerbRatio < 0.6) {
    errors.push('At least 60% of experience bullets must start with a strong action verb.');
  }
  const hasMeasurable = normalized.some((b) => /\d/.test(b));
  if (!hasMeasurable) {
    errors.push('Add at least one measurable outcome (numbers, percentages, or metrics).');
  }

  if (errors.length) {
    throw new BadRequestException({ errors });
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

function validatePdfExportSafety(resume: {
  summary: string;
  skills: string[];
  experience: unknown;
  education: unknown;
  projects?: unknown;
  certifications?: unknown;
}) {
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

  if (result.roleAdjustedScore < MIN_PDF_ATS_SCORE) {
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
  const jdTokens = tokenize(input.jdText);
  const jdKeywordWeights = extractKeywordWeights(input.jdText, 24);
  const jdKeywords = Array.from(jdKeywordWeights.keys());

  const keywordOverlapScore = jdKeywords.length
    ? jdKeywords.reduce((acc, k) => acc + (resumeTokens.has(k) ? (jdKeywordWeights.get(k) || 0) : 0), 0) /
      totalWeight(jdKeywordWeights)
    : 0;

  const skillCoverageScore = input.skills.length && jdKeywords.length
    ? input.skills.filter((s) => jdTokens.has(s.toLowerCase())).length / input.skills.length
    : 0;

  const roleLevel = detectRoleLevel({
    resumeText: input.resumeText,
    jdText: input.jdText,
    experienceCount: input.experienceCount,
  });

  const sectionWeights = roleLevel === 'FRESHER'
    ? { experience: 0.2, skills: 0.4, education: 0.2, summary: 0.2 }
    : roleLevel === 'SENIOR'
      ? { experience: 0.5, skills: 0.2, education: 0.1, summary: 0.2 }
      : { experience: 0.35, skills: 0.3, education: 0.15, summary: 0.2 };

  const sectionCompleteness =
    Number(input.sections.experience) * sectionWeights.experience +
    Number(input.sections.skills) * sectionWeights.skills +
    Number(input.sections.education) * sectionWeights.education +
    Number(input.sections.summary) * sectionWeights.summary;

  const bulletQuality = scoreBullets(input.bullets.expBullets);
  const actionVerbScore = bulletQuality.actionVerbRatio;
  const bulletDensityScore = bulletQuality.densityScore;

  const semanticSimilarity = input.jdText
    ? cosineSimilarity(embedding(input.resumeText), embedding(input.jdText))
    : 0;

  const weights = roleLevel === 'FRESHER'
    ? { keyword: 0.28, skill: 0.24, sections: 0.2, semantic: 0.12, bullets: 0.16 }
    : roleLevel === 'SENIOR'
      ? { keyword: 0.2, skill: 0.12, sections: 0.28, semantic: 0.2, bullets: 0.2 }
      : { keyword: 0.3, skill: 0.2, sections: 0.22, semantic: 0.16, bullets: 0.12 };

  const roleAdjustedScore =
    weights.keyword * keywordOverlapScore +
    weights.skill * skillCoverageScore +
    weights.sections * sectionCompleteness +
    weights.semantic * semanticSimilarity +
    weights.bullets * ((actionVerbScore + bulletDensityScore) / 2);

  const atsScore = Math.max(5, Math.min(100, Math.round(roleAdjustedScore * 100)));
  const missingKeywords = jdKeywords.filter((k) => !resumeTokens.has(k));

  const rejectionReasons: string[] = [];
  if (!input.sections.experience) rejectionReasons.push('Missing Experience section.');
  if (!input.sections.skills) rejectionReasons.push('Missing Skills section (minimum 3 skills).');
  if (!input.sections.education) rejectionReasons.push('Missing Education section.');
  if (bulletQuality.tooLongCount > 0) rejectionReasons.push('Bullets exceed recommended length.');
  if (actionVerbScore < 0.4) rejectionReasons.push('Too few bullets start with strong action verbs.');

  const improvementSuggestions = buildSuggestions({
    missingKeywords,
    sections: input.sections,
    jdProvided: Boolean(input.jdText),
    bulletQuality,
  });

  const details = [
    `Role level: ${roleLevel}.`,
    `Keyword relevance: ${(keywordOverlapScore * 100).toFixed(0)}%.`,
    `Skill coverage: ${(skillCoverageScore * 100).toFixed(0)}%.`,
    `Section weighting: ${(sectionCompleteness * 100).toFixed(0)}%.`,
    `Bullet quality: ${Math.round(((actionVerbScore + bulletDensityScore) / 2) * 100)}%.`,
    `Semantic similarity: ${(semanticSimilarity * 100).toFixed(0)}%.`,
  ];

  return { atsScore, roleLevel, roleAdjustedScore: Math.round(roleAdjustedScore * 100), rejectionReasons, improvementSuggestions, details, missingKeywords };
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
    return { actionVerbRatio: 0, densityScore: 0, tooLongCount: 0 };
  }
  const normalized = bullets.map((b) => b.trim()).filter(Boolean);
  const actionVerbCount = normalized.filter((b) => ACTION_VERBS.has(firstWord(b))).length;
  const tooLongCount = normalized.filter((b) => wordCount(b) > 28).length;
  const avgWords = normalized.reduce((acc, b) => acc + wordCount(b), 0) / normalized.length;
  const densityScore = avgWords >= 8 && avgWords <= 22 ? 1 : avgWords < 8 ? 0.5 : 0.3;
  return {
    actionVerbRatio: actionVerbCount / normalized.length,
    densityScore,
    tooLongCount,
  };
}

function firstWord(text: string) {
  return text.toLowerCase().split(/\s+/)[0] || '';
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
  bulletQuality: { actionVerbRatio: number; densityScore: number; tooLongCount: number };
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
  if (input.bulletQuality.actionVerbRatio < 0.6) {
    suggestions.push('Start most bullets with action verbs (e.g., Built, Led, Improved).');
  }
  if (!input.jdProvided) {
    suggestions.push('Upload a job description for better keyword matching.');
  }
  return suggestions.slice(0, 7);
}




