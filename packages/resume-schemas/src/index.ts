import { z } from 'zod';

export const RoleLevelSchema = z.enum(['FRESHER', 'MID', 'SENIOR']);

export const ContactSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(6).optional(),
  location: z.string().min(2).optional(),
  links: z.array(z.string().min(3)).optional(),
});

export const ExperienceItemSchema = z.object({
  company: z.string().min(1),
  role: z.string().min(1),
  startDate: z.string().optional().default(''),
  endDate: z.string().optional().default(''),
  highlights: z.array(z.string().min(1)).default([]),
});

export const EducationItemSchema = z.object({
  institution: z.string().min(1),
  degree: z.string().min(1),
  startDate: z.string().optional().default(''),
  endDate: z.string().optional().default(''),
  details: z.array(z.string().min(1)).default([]),
});

export const ProjectItemSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  highlights: z.array(z.string().min(1)).default([]),
});

export const CertificationItemSchema = z.object({
  name: z.string().min(1),
  issuer: z.string().optional(),
  date: z.string().optional(),
  details: z.array(z.string().min(1)).optional(),
});

// Relaxed schemas for upload parsing/mapping before user confirmation.
export const ParsedContactSchema = z.object({
  fullName: z.string().optional().default(''),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  links: z.array(z.string()).optional(),
});

export const ParsedExperienceItemSchema = z.object({
  company: z.string().optional().default(''),
  role: z.string().optional().default(''),
  startDate: z.string().optional().default(''),
  endDate: z.string().optional().default(''),
  highlights: z.array(z.string()).default([]),
});

export const ParsedEducationItemSchema = z.object({
  institution: z.string().optional().default(''),
  degree: z.string().optional().default(''),
  startDate: z.string().optional().default(''),
  endDate: z.string().optional().default(''),
  details: z.array(z.string()).default([]),
});

export const ParsedProjectItemSchema = z.object({
  name: z.string().optional().default(''),
  role: z.string().optional().default(''),
  startDate: z.string().optional().default(''),
  endDate: z.string().optional().default(''),
  highlights: z.array(z.string()).default([]),
});

export const ParsedCertificationItemSchema = z.object({
  name: z.string().optional().default(''),
  issuer: z.string().optional().default(''),
  date: z.string().optional().default(''),
  details: z.array(z.string()).default([]),
});

export const ResumeSectionsSchema = z.object({
  title: z.string().min(1),
  contact: ContactSchema.optional(),
  summary: z.string().min(1),
  skills: z.array(z.string().min(1)).default([]),
  experience: z.array(ExperienceItemSchema).default([]),
  education: z.array(EducationItemSchema).default([]),
  projects: z.array(ProjectItemSchema).default([]),
  certifications: z.array(CertificationItemSchema).default([]),
  unmappedText: z.string().optional(),
  roleLevel: RoleLevelSchema.optional(),
});

export const ParsedResumeSchema = z.object({
  title: z.string().optional().default(''),
  contact: ParsedContactSchema.optional(),
  summary: z.string().optional().default(''),
  skills: z.array(z.string()).default([]),
  experience: z.array(ParsedExperienceItemSchema).default([]),
  education: z.array(ParsedEducationItemSchema).default([]),
  projects: z.array(ParsedProjectItemSchema).default([]),
  certifications: z.array(ParsedCertificationItemSchema).default([]),
  unmappedText: z.string().optional(),
  roleLevel: RoleLevelSchema.optional(),
});

export type RoleLevel = z.infer<typeof RoleLevelSchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type ExperienceItem = z.infer<typeof ExperienceItemSchema>;
export type EducationItem = z.infer<typeof EducationItemSchema>;
export type ProjectItem = z.infer<typeof ProjectItemSchema>;
export type CertificationItem = z.infer<typeof CertificationItemSchema>;
export type ResumeSections = z.infer<typeof ResumeSectionsSchema>;
export type ParsedResume = z.infer<typeof ParsedResumeSchema>;
