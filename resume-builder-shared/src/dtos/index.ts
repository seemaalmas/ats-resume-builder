export type RegisterDto = {
  fullName: string;
  email: string;
  password: string;
};

export type LoginDto = {
  email: string;
  password: string;
};

export type CreateResumeDto = {
  title: string;
  contact?: {
    fullName: string;
    email?: string;
    phone?: string;
    location?: string;
    links?: string[];
  };
  summary: string;
  skills?: string[];
  experience?: {
    company: string;
    role: string;
    startDate: string;
    endDate: string;
    highlights: string[];
  }[];
  education?: {
    institution: string;
    degree: string;
    startDate: string;
    endDate: string;
    details: string[];
  }[];
  projects?: {
    name: string;
    role?: string;
    startDate?: string;
    endDate?: string;
    highlights: string[];
  }[];
  certifications?: {
    name: string;
    issuer?: string;
    date?: string;
    details?: string[];
  }[];
};

export type UpdateResumeDto = {
  title?: string;
  contact?: {
    fullName: string;
    email?: string;
    phone?: string;
    location?: string;
    links?: string[];
  };
  summary?: string;
  skills?: string[];
  experience?: {
    company: string;
    role: string;
    startDate: string;
    endDate: string;
    highlights: string[];
  }[];
  education?: {
    institution: string;
    degree: string;
    startDate: string;
    endDate: string;
    details: string[];
  }[];
  projects?: {
    name: string;
    role?: string;
    startDate?: string;
    endDate?: string;
    highlights: string[];
  }[];
  certifications?: {
    name: string;
    issuer?: string;
    date?: string;
    details?: string[];
  }[];
};

export type ParseJdDto = {
  text: string;
};

export type ScoreResumeDto = {
  resumeText: string;
  jdSummary: {
    skills: string[];
    responsibilities: string[];
    seniority: string;
  };
};

export type RefreshTokenDto = {
  userId: string;
  refreshToken: string;
};

export type AtsScoreRequestDto = {
  jdText?: string;
};

export type AiParseJdDto = {
  text: string;
};

export type AiCritiqueDto = {
  resumeText: string;
  jdText?: string;
};

export type AiSkillGapDto = {
  resumeText: string;
  jdText: string;
};

export type CreateCheckoutSessionDto = {
  plan: 'STUDENT' | 'PRO';
};
