import type { ProjectItem, ResumeDraft } from './resume-store';

export const EMPTY_PROJECT: ProjectItem = {
  name: '',
  role: '',
  startDate: '',
  endDate: '',
  url: '',
  highlights: [],
};

export function addEmptyProject(resume: ResumeDraft): ResumeDraft {
  return {
    ...resume,
    projects: [...resume.projects, { ...EMPTY_PROJECT }],
  };
}

export function ensureAtLeastOneProject(projects: ProjectItem[]) {
  if (Array.isArray(projects) && projects.length > 0) {
    return projects;
  }
  return [{ ...EMPTY_PROJECT }];
}

export function moveProject(resume: ResumeDraft, index: number, direction: -1 | 1): ResumeDraft {
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || index >= resume.projects.length || targetIndex >= resume.projects.length) {
    return resume;
  }
  const nextProjects = [...resume.projects];
  const current = nextProjects[index];
  nextProjects[index] = nextProjects[targetIndex];
  nextProjects[targetIndex] = current;
  return {
    ...resume,
    projects: nextProjects,
  };
}

export function isValidProjectUrl(url: string) {
  const raw = String(url || '').trim();
  if (!raw) return true;
  if (!/^https:\/\//i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
