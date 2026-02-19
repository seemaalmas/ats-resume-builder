import type { ExperienceItem } from './resume-store';
import { compareYearMonth, isPresentToken, isYearMonth, toYearMonth } from './date-utils';

export type ExperienceFieldErrors = {
  company?: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  highlights?: string;
};

export type ExperienceValidationResult = {
  hasErrors: boolean;
  hasAnyContent: boolean;
  entries: ExperienceFieldErrors[];
};

export function validateExperienceEntries(experience: ExperienceItem[]): ExperienceValidationResult {
  const entries = experience.map(validateExperienceEntry);
  const hasErrors = entries.some((entry) => Object.keys(entry).length > 0);
  const hasAnyContent = experience.some((entry) => hasExperienceContent(entry));
  return { hasErrors, hasAnyContent, entries };
}

export function validateExperienceEntry(entry: ExperienceItem): ExperienceFieldErrors {
  const company = String(entry.company || '').trim();
  const role = String(entry.role || '').trim();
  const startDateRaw = String(entry.startDate || '').trim();
  const endDateRaw = String(entry.endDate || '').trim();
  const highlights = (entry.highlights || []).map((line) => line.trim()).filter(Boolean);
  const errors: ExperienceFieldErrors = {};

  if (!hasExperienceContent(entry)) {
    return errors;
  }

  if (company.length < 2) {
    errors.company = 'Company is required.';
  }
  if (role.length < 2) {
    errors.role = 'Role is required.';
  }

  if (!startDateRaw) {
    errors.startDate = 'Start date is required.';
  } else {
    const normalizedStart = toYearMonth(startDateRaw);
    if (!isYearMonth(normalizedStart)) {
      errors.startDate = 'Use YYYY-MM.';
    }
  }

  if (!endDateRaw) {
    errors.endDate = 'End date is required (YYYY-MM or Present).';
  } else {
    const normalizedEnd = toYearMonth(endDateRaw);
    const endValid = isYearMonth(normalizedEnd) || isPresentToken(normalizedEnd);
    if (!endValid) {
      errors.endDate = 'Use YYYY-MM or Present.';
    }
  }

  const normalizedStart = toYearMonth(startDateRaw);
  const normalizedEnd = toYearMonth(endDateRaw);
  if (
    isYearMonth(normalizedStart) &&
    isYearMonth(normalizedEnd) &&
    compareYearMonth(normalizedEnd, normalizedStart) < 0
  ) {
    errors.endDate = 'End date must be after start date.';
  }

  if (!highlights.length) {
    errors.highlights = 'Add at least one highlight.';
  }

  return errors;
}

export function normalizeExperienceDatesForSave(entry: ExperienceItem): ExperienceItem {
  const startDate = toYearMonth(entry.startDate || '') || String(entry.startDate || '').trim();
  const endDate = toYearMonth(entry.endDate || '') || String(entry.endDate || '').trim();
  return {
    ...entry,
    startDate,
    endDate,
  };
}

function hasExperienceContent(entry: ExperienceItem) {
  return Boolean(
    String(entry.company || '').trim() ||
    String(entry.role || '').trim() ||
    String(entry.startDate || '').trim() ||
    String(entry.endDate || '').trim() ||
    (entry.highlights || []).some((line) => String(line || '').trim()),
  );
}
