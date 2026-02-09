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
  details: string[];
};

export type ProjectItem = {
  name: string;
  role?: string;
  startDate?: string;
  endDate?: string;
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
  experience: ExperienceItem[];
  education: EducationItem[];
  projects: ProjectItem[];
  certifications: CertificationItem[];
};

const emptyExperience: ExperienceItem = { company: '', role: '', startDate: '', endDate: '', highlights: [''] };
const emptyEducation: EducationItem = { institution: '', degree: '', startDate: '', endDate: '', details: [''] };
const emptyProject: ProjectItem = { name: '', role: '', startDate: '', endDate: '', highlights: [''] };
const emptyCertification: CertificationItem = { name: '', issuer: '', date: '', details: [''] };

export function getEmptyResumeDraft(): ResumeDraft {
  return {
    title: '',
    contact: { fullName: '' },
    summary: '',
    skills: [],
    experience: [structuredClone(emptyExperience)],
    education: [structuredClone(emptyEducation)],
    projects: [structuredClone(emptyProject)],
    certifications: [structuredClone(emptyCertification)],
  };
}

type ResumeStore = {
  resume: ResumeDraft;
  setResume: (updater: ResumeDraft | ((prev: ResumeDraft) => ResumeDraft)) => void;
  replaceResume: (resume: ResumeDraft) => void;
  resetResume: () => void;
};

export const useResumeStore = create<ResumeStore>((set) => ({
  resume: getEmptyResumeDraft(),
  setResume: (updater) =>
    set((state) => ({
      resume: typeof updater === 'function'
        ? (updater as (prev: ResumeDraft) => ResumeDraft)(state.resume)
        : updater,
    })),
  replaceResume: (resume) => set({ resume }),
  resetResume: () => set({ resume: getEmptyResumeDraft() }),
}));
