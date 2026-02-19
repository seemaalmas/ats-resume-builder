import type { ResumeDraft } from './resume-store';

export function addEmptyExperience(resume: ResumeDraft) {
  return {
    ...resume,
    experience: [
      ...resume.experience,
      { company: '', role: '', startDate: '', endDate: '', highlights: [''] },
    ],
  };
}

export function removeExperienceAt(resume: ResumeDraft, index: number) {
  const next = resume.experience.filter((_, i) => i !== index);
  return {
    ...resume,
    experience: next.length
      ? next
      : [{ company: '', role: '', startDate: '', endDate: '', highlights: [''] }],
  };
}
