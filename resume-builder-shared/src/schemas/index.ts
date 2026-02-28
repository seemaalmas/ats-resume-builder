import { z } from 'zod';

const ContactSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email().optional(),
  phone: z.string().min(6).optional(),
  location: z.string().min(2).optional(),
  links: z.array(z.string().min(3)).optional(),
});

const ExperienceSchema = z.object({
  company: z.string().min(2),
  role: z.string().min(2),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  highlights: z.array(z.string()).min(1),
});

const EducationSchema = z.object({
  institution: z.string().min(2),
  degree: z.string().min(2),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  details: z.array(z.string()).optional(),
  gpa: z.number().min(0).max(10).nullable().optional(),
  percentage: z.number().min(0).max(100).nullable().optional(),
}).refine((value) => !(value.gpa != null && value.percentage != null), {
  message: 'Provide either GPA or percentage, not both.',
  path: ['gpa'],
});

const ProjectSchema = z.object({
  name: z.string().min(2),
  role: z.string().min(2).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  url: z.string().url().refine((value) => /^https:\/\//i.test(value), { message: 'Project URL must start with https://' }).optional(),
  highlights: z.array(z.string()).min(1),
});

const CertificationSchema = z.object({
  name: z.string().min(2),
  issuer: z.string().min(2).optional(),
  date: z.string().optional(),
  details: z.array(z.string()).optional(),
});

export const RegisterSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const CreateResumeSchema = z.object({
  title: z.string().min(2),
  contact: ContactSchema.optional(),
  summary: z.string().min(20),
  skills: z.array(z.string()).optional(),
  technicalSkills: z.array(z.string()).optional(),
  softSkills: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  experience: z.array(ExperienceSchema).optional(),
  education: z.array(EducationSchema).optional(),
  projects: z.array(ProjectSchema).optional(),
  certifications: z.array(CertificationSchema).optional(),
  templateId: z.string().trim().min(1).optional(),
});

export const UpdateResumeSchema = z.object({
  title: z.string().min(2).optional(),
  contact: ContactSchema.optional(),
  summary: z.string().min(20).optional(),
  skills: z.array(z.string()).optional(),
  technicalSkills: z.array(z.string()).optional(),
  softSkills: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  experience: z.array(ExperienceSchema).optional(),
  education: z.array(EducationSchema).optional(),
  projects: z.array(ProjectSchema).optional(),
  certifications: z.array(CertificationSchema).optional(),
  templateId: z.string().trim().min(1).optional(),
});

export const DuplicateResumeSchema = z.object({
  title: z.string().min(2).optional(),
});

export const ParseJdSchema = z.object({
  text: z.string().min(10),
});

export const ScoreResumeSchema = z.object({
  resumeText: z.string().min(20),
  jdSummary: z.object({
    skills: z.array(z.string()).default([]),
    responsibilities: z.array(z.string()).default([]),
    seniority: z.string().default('mid'),
  }),
});

export const AtsScoreRequestSchema = z.object({
  jdText: z.string().min(20).optional(),
});

export const AiParseJdSchema = z.object({
  text: z.string().min(20),
});

export const AiCritiqueSchema = z.object({
  resumeText: z.string().min(40),
  jdText: z.string().min(20).optional(),
});

export const AiSkillGapSchema = z.object({
  resumeText: z.string().min(40),
  jdText: z.string().min(20),
});

export const PlanSchema = z.enum(['FREE', 'STUDENT', 'PRO']);

export const CreateCheckoutSessionSchema = z.object({
  plan: z.enum(['STUDENT', 'PRO']),
});

export const RefreshTokenSchema = z.object({
  userId: z.string().min(8),
  refreshToken: z.string().min(20),
});
