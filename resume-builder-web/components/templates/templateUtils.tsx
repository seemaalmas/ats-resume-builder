import {
  formatDateRange,
  getAtsSectionTitle,
  normalizeResumeForAts,
  type AtsSectionKey,
  type ResumeImportResult,
} from 'resume-builder-shared';

export type TemplateProps = {
  resumeData: ResumeImportResult;
};

export function cleanList(values: string[] | undefined) {
  return (values || []).map((item) => String(item || '').trim()).filter(Boolean);
}

export function normalizeTemplateResume(resumeData: ResumeImportResult) {
  return normalizeResumeForAts(resumeData);
}

export function sectionTitle(section: Exclude<AtsSectionKey, 'header'>) {
  return getAtsSectionTitle(section);
}

export function displayDateRange(startDate: string, endDate: string) {
  return formatDateRange(String(startDate || ''), String(endDate || ''));
}

export function fullNameOrTitle(resumeData: ResumeImportResult) {
  const title = String(resumeData.title || '').trim();
  const fullName = String(resumeData.contact?.fullName || '').trim();
  return title || fullName || 'Resume';
}

export function contactLine(resumeData: ResumeImportResult) {
  const parts = [
    resumeData.contact?.email,
    resumeData.contact?.phone,
    resumeData.contact?.location,
    ...(resumeData.contact?.links || []),
  ].map((item) => String(item || '').trim()).filter(Boolean);
  return parts.join(' | ');
}

export function experienceItems(resumeData: ResumeImportResult) {
  return (resumeData.experience || []).filter((item) => {
    return Boolean(
      String(item.role || '').trim() ||
      String(item.company || '').trim() ||
      cleanList(item.highlights).length,
    );
  });
}

export function educationItems(resumeData: ResumeImportResult) {
  return (resumeData.education || []).filter((item) => {
    return Boolean(String(item.degree || '').trim() || String(item.institution || '').trim());
  });
}

export function projectItems(resumeData: ResumeImportResult) {
  return (resumeData.projects || []).filter((item) => {
    return Boolean(String(item.name || '').trim() || cleanList(item.highlights).length);
  });
}

export function certificationItems(resumeData: ResumeImportResult) {
  return (resumeData.certifications || []).filter((item) => {
    return Boolean(String(item.name || '').trim() || cleanList(item.details || []).length);
  });
}
