import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ResumeService } from '../../resume/resume.service';
import { computeExperienceLevel } from 'resume-intelligence';
import { ResumeSectionsSchema } from 'resume-schemas';

type UploadedResumeFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

@Injectable()
export class IntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resumeService: ResumeService,
  ) {}

  async ingest(userId: string, resumeId: string, file: UploadedResumeFile) {
    const current = await this.resumeService.get(userId, resumeId);
    const mapped = await this.resumeService.parseResumeUpload(file);
    const merged = mergeResumeData(current, mapped);
    const parsed = ResumeSectionsSchema.safeParse({
      title: merged.title,
      contact: merged.contact,
      summary: merged.summary,
      skills: merged.skills,
      experience: merged.experience,
      education: merged.education,
      projects: merged.projects || [],
      certifications: merged.certifications || [],
      unmappedText: mapped.unmappedText,
      roleLevel: mapped.roleLevel,
    });

    if (!parsed.success) {
      throw new BadRequestException({ errors: parsed.error.issues.map((issue) => issue.message) });
    }

    const level = computeExperienceLevel({
      resumeText: buildResumeText(parsed.data),
      experience: parsed.data.experience,
    });

    const updated = await this.prisma.resume.update({
      where: { id: resumeId },
      data: {
        title: parsed.data.title,
        contact: parsed.data.contact || undefined,
        summary: parsed.data.summary,
        skills: parsed.data.skills,
        experience: parsed.data.experience,
        education: parsed.data.education,
        projects: parsed.data.projects,
        certifications: parsed.data.certifications,
      },
    });

    return {
      resume: updated,
      mapped: {
        ...mapped,
        roleLevel: level.level,
      },
      signals: level.signals,
    };
  }

  async recompute(userId: string, resumeId: string) {
    const resume = await this.resumeService.get(userId, resumeId);
    const parsed = ResumeSectionsSchema.safeParse({
      title: resume.title,
      contact: resume.contact || undefined,
      summary: resume.summary,
      skills: resume.skills || [],
      experience: Array.isArray(resume.experience) ? resume.experience : [],
      education: Array.isArray(resume.education) ? resume.education : [],
      projects: Array.isArray(resume.projects) ? resume.projects : [],
      certifications: Array.isArray(resume.certifications) ? resume.certifications : [],
    });
    if (!parsed.success) {
      throw new BadRequestException({ errors: parsed.error.issues.map((issue) => issue.message) });
    }
    const level = computeExperienceLevel({
      resumeText: buildResumeText(parsed.data),
      experience: parsed.data.experience,
    });
    return {
      resumeId,
      roleLevel: level.level,
      signals: level.signals,
    };
  }
}

function mergeResumeData(
  current: {
    title: string;
    contact: any;
    summary: string;
    skills: string[];
    experience: any;
    education: any;
    projects: any;
    certifications: any;
  },
  mapped: {
    title: string;
    contact?: any;
    summary: string;
    skills: string[];
    experience: any[];
    education: any[];
    projects?: any[];
    certifications?: any[];
  },
) {
  return {
    title: current.title || mapped.title,
    contact: mergeContact(current.contact || {}, mapped.contact || {}),
    summary: current.summary || mapped.summary,
    skills: mergeStringList(current.skills || [], mapped.skills || []),
    experience: mergeExperience(Array.isArray(current.experience) ? current.experience : [], mapped.experience || []),
    education: mergeByKey(Array.isArray(current.education) ? current.education : [], mapped.education || [], (item: any) => `${item.institution}|${item.degree}`),
    projects: mergeByKey(Array.isArray(current.projects) ? current.projects : [], mapped.projects || [], (item: any) => item.name || ''),
    certifications: mergeByKey(Array.isArray(current.certifications) ? current.certifications : [], mapped.certifications || [], (item: any) => item.name || ''),
  };
}

function mergeContact(current: any, incoming: any) {
  return {
    fullName: current.fullName || incoming.fullName || 'Your Name',
    email: current.email || incoming.email,
    phone: current.phone || incoming.phone,
    location: current.location || incoming.location,
    links: mergeStringList(current.links || [], incoming.links || []),
  };
}

function mergeStringList(current: string[], incoming: string[]) {
  const merged = [...current, ...incoming].map((item) => String(item || '').trim()).filter(Boolean);
  return Array.from(new Set(merged));
}

function mergeExperience(current: any[], incoming: any[]) {
  if (!incoming.length) return current;
  if (!current.length) return incoming;
  const map = new Map<string, any>();
  for (const item of current) {
    map.set(experienceKey(item), item);
  }
  for (const item of incoming) {
    const key = experienceKey(item);
    if (!map.has(key)) {
      map.set(key, item);
      continue;
    }
    const existing = map.get(key);
    map.set(key, {
      ...existing,
      role: existing.role || item.role,
      company: existing.company || item.company,
      startDate: existing.startDate || item.startDate,
      endDate: existing.endDate || item.endDate,
      highlights: mergeStringList(existing.highlights || [], item.highlights || []),
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    const endA = dateSortValue(String(a.endDate || a.startDate || ''), true);
    const endB = dateSortValue(String(b.endDate || b.startDate || ''), true);
    if (endB !== endA) return endB - endA;
    return dateSortValue(String(b.startDate || ''), false) - dateSortValue(String(a.startDate || ''), false);
  });
}

function mergeByKey(current: any[], incoming: any[], keyFn: (item: any) => string) {
  if (!incoming.length) return current;
  if (!current.length) return incoming;
  const map = new Map<string, any>();
  for (const item of current) map.set(keyFn(item), item);
  for (const item of incoming) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function experienceKey(item: any) {
  const company = String(item.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const role = String(item.role || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const startDate = String(item.startDate || '');
  const endDate = String(item.endDate || '');
  return `${company}|${role}|${startDate}|${endDate}`;
}

function dateSortValue(token: string, end: boolean) {
  const parsed = parseDateToken(token, end);
  if (!parsed) return 0;
  return parsed.year * 100 + parsed.month;
}

function parseDateToken(token: string, end: boolean) {
  if (!token) return null;
  if (/present|current|now/i.test(token)) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  const clean = token.toLowerCase().trim();
  const monthMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };
  const monthYear = clean.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{4})/);
  if (monthYear) {
    const month = monthMap[monthYear[1].slice(0, 4)] || monthMap[monthYear[1].slice(0, 3)] || 1;
    return { year: Number(monthYear[2]), month };
  }
  const yearMonth = clean.match(/(\d{4})[-/](\d{1,2})/);
  if (yearMonth) {
    return { year: Number(yearMonth[1]), month: Math.max(1, Math.min(12, Number(yearMonth[2]))) };
  }
  const year = clean.match(/\b(19\d{2}|20\d{2})\b/);
  if (year) {
    return { year: Number(year[1]), month: end ? 12 : 1 };
  }
  return null;
}

function buildResumeText(resume: {
  summary: string;
  skills: string[];
  experience: Array<{ role: string; company: string; highlights: string[] }>;
  education: Array<{ degree: string; institution: string; details: string[] }>;
}) {
  const expText = resume.experience
    .map((item) => [item.role, item.company, ...(item.highlights || [])].join(' '))
    .join(' ');
  const eduText = resume.education
    .map((item) => [item.degree, item.institution, ...(item.details || [])].join(' '))
    .join(' ');
  return [resume.summary, resume.skills.join(' '), expText, eduText].filter(Boolean).join(' ');
}
