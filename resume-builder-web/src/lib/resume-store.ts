'use client';

import { create } from 'zustand';

export type ContactInfo = {
  fullName: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: string[];
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

export type ResumeDraft = {
  title: string;
  contact: ContactInfo;
  summary: string;
  skills: string[];
  technicalSkills?: string[];
  softSkills?: string[];
  languages?: string[];
  experience: ExperienceItem[];
  education: EducationItem[];
  projects: ProjectItem[];
  certifications: CertificationItem[];
};

export type AtsReviewResult = {
  resumeId: string;
  atsScore: number;
  roleLevel: 'FRESHER' | 'MID' | 'SENIOR';
  roleAdjustedScore: number;
  rejectionReasons: string[];
  improvementSuggestions: string[];
  details: string[];
  missingKeywords: string[];
};

export type AtsReviewState = {
  loading: boolean;
  error: string;
  result: AtsReviewResult | null;
  lastCheckedAt: string;
};

const emptyExperience: ExperienceItem = { company: '', role: '', startDate: '', endDate: '', highlights: [''] };
const emptyEducation: EducationItem = { institution: '', degree: '', startDate: '', endDate: '', details: [], gpa: null, percentage: null };
const emptyProject: ProjectItem = { name: '', role: '', startDate: '', endDate: '', url: '', highlights: [] };
const emptyCertification: CertificationItem = { name: '', issuer: '', date: '', details: [''] };

export function getEmptyResumeDraft(): ResumeDraft {
  return {
    title: '',
    contact: { fullName: '' },
    summary: '',
    skills: [],
    technicalSkills: [],
    softSkills: [],
    languages: [],
    experience: [],
    education: [],
    projects: [],
    certifications: [],
  };
}

function getEmptyAtsReviewState(): AtsReviewState {
  return {
    loading: false,
    error: '',
    result: null,
    lastCheckedAt: '',
  };
}

type ResumeStore = {
  resume: ResumeDraft;
  uploadedFileName: string;
  atsReview: AtsReviewState;
  setResume: (updater: ResumeDraft | ((prev: ResumeDraft) => ResumeDraft)) => void;
  replaceResume: (resume: ResumeDraft) => void;
  setUploadedFileName: (fileName: string) => void;
  setAtsReview: (updater: AtsReviewState | ((prev: AtsReviewState) => AtsReviewState)) => void;
  resetAtsReview: () => void;
  resetResume: () => void;
};

export const useResumeStore = create<ResumeStore>((set) => ({
  resume: getEmptyResumeDraft(),
  uploadedFileName: '',
  atsReview: getEmptyAtsReviewState(),
  setResume: (updater) =>
    set((state) => ({
      resume: typeof updater === 'function'
        ? (updater as (prev: ResumeDraft) => ResumeDraft)(state.resume)
        : updater,
    })),
  replaceResume: (resume) => set({ resume }),
  setUploadedFileName: (fileName) => set({ uploadedFileName: String(fileName || '').trim() }),
  setAtsReview: (updater) =>
    set((state) => ({
      atsReview: typeof updater === 'function'
        ? (updater as (prev: AtsReviewState) => AtsReviewState)(state.atsReview)
        : updater,
    })),
  resetAtsReview: () => set({ atsReview: getEmptyAtsReviewState() }),
  resetResume: () => set({
    resume: getEmptyResumeDraft(),
    uploadedFileName: '',
    atsReview: getEmptyAtsReviewState(),
  }),
}));
