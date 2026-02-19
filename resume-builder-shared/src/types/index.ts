export type User = {
  id: string;
  email: string;
  fullName: string;
};

export type ContactInfo = {
  fullName: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: string[];
};

export type Resume = {
  id: string;
  userId: string;
  title: string;
  contact?: ContactInfo;
  summary: string;
  skills: string[];
  technicalSkills?: string[];
  softSkills?: string[];
  languages?: string[];
  experience: ExperienceItem[];
  education: EducationItem[];
  projects?: ProjectItem[];
  certifications?: CertificationItem[];
  createdAt: string;
  updatedAt: string;
};

export type ResumeImportResult = {
  title: string;
  contact?: ContactInfo;
  summary: string;
  skills: string[];
  technicalSkills?: string[];
  softSkills?: string[];
  languages?: string[];
  experience: ExperienceItem[];
  education: EducationItem[];
  projects?: ProjectItem[];
  certifications?: CertificationItem[];
  roleLevel?: 'FRESHER' | 'MID' | 'SENIOR';
  unmappedText?: string;
  text?: string;
  parsed?: {
    title: string;
    contact?: ContactInfo;
    summary: string;
    skills: string[];
    technicalSkills?: string[];
    softSkills?: string[];
    languages?: string[];
    experience: ExperienceItem[];
    education: EducationItem[];
    projects?: ProjectItem[];
    certifications?: CertificationItem[];
    roleLevel?: 'FRESHER' | 'MID' | 'SENIOR';
    unmappedText?: string;
  };
};

export type ExperienceItem = {
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  highlights: string[];
};

export type EducationItem = {
  institution: string;
  degree: string;
  startDate: string;
  endDate: string;
  details?: string[];
  gpa?: number | null;
  percentage?: number | null;
};

export type ProjectItem = {
  name: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  highlights: string[];
};

export type CertificationItem = {
  name: string;
  issuer?: string;
  date?: string;
  details?: string[];
};

export type AtsScoreResult = {
  resumeId: string;
  atsScore: number;
  roleLevel: 'FRESHER' | 'MID' | 'SENIOR';
  roleAdjustedScore: number;
  rejectionReasons: string[];
  improvementSuggestions: string[];
  details: string[];
  missingKeywords: string[];
  actionVerbRule?: {
    requiredRatio: number;
    percentage: number;
    strongBullets: number;
    totalBullets: number;
    requiredStrongBullets: number;
    remainingToPass: number;
    passes: boolean;
    failedBullets: Array<{
      index: number;
      reason: 'weak_starter' | 'not_strong_enough';
      suggestions: string[];
    }>;
    message: string;
  };
};

export type DuplicateResumeResult = Resume;

export type JobDescriptionSummary = {
  skills: string[];
  responsibilities: string[];
  seniority: string;
};

export type ResumeScoreResult = {
  score: number;
  suggestions: string[];
  matchedSkills: string[];
  missingSkills: string[];
};

export type JdParseResult = {
  skills: string[];
  responsibilities: string[];
  seniority: string;
};

export type ResumeCritiqueResult = {
  highlights: string[];
  weaknesses: string[];
  rewrittenSummary: string;
};

export type SkillGapResult = {
  missingSkills: string[];
  recommendedKeywords: string[];
};

export type Plan = 'FREE' | 'STUDENT' | 'PRO';

export type DuplicateResumeDto = {
  title?: string;
};
