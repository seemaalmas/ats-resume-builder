'use client';

import type { ResumeImportResult } from 'resume-builder-shared';
import { defaultTemplateId, resolveTemplateId, templateList, templateRegistry, type TemplateId } from '@/shared/templateRegistry';

export type TemplateVariant = TemplateId;

export const templates = templateList;
export type { TemplateId };

export function TemplatePreview({
  templateId,
  resume,
}: {
  templateId: TemplateId | string;
  resume: ResumeImportResult;
  compact?: boolean;
  accentOverride?: string;
  fontOverride?: string;
  spacing?: 'compact' | 'normal' | 'airy';
}) {
  const resolvedTemplateId = resolveTemplateId(String(templateId || ''), defaultTemplateId);
  const TemplateComponent = templateRegistry[resolvedTemplateId].component;
  return <TemplateComponent resumeData={resume} />;
}

