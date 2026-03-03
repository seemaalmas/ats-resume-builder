import type { ComponentType } from 'react';
import type { ResumeImportResult } from 'resume-builder-shared';
import ClassicATS from '@/components/templates/ClassicATS';
import ExecutiveImpact from '@/components/templates/ExecutiveImpact';
import GraduateStarter from '@/components/templates/GraduateStarter';
import ModernProfessional from '@/components/templates/ModernProfessional';
import TechnicalCompact from '@/components/templates/TechnicalCompact';

export type TemplateComponentProps = {
  resumeData: ResumeImportResult;
};

export type TemplateConfig = {
  id: string;
  name: string;
  description: string;
  component: ComponentType<TemplateComponentProps>;
};

export const templateRegistry = {
  classic: {
    id: 'classic',
    name: 'Classic ATS',
    description: 'Single-column ATS-safe structure with bold headings.',
    component: ClassicATS,
  },
  modern: {
    id: 'modern',
    name: 'Modern Professional',
    description: 'Clean modern format with subtle section dividers.',
    component: ModernProfessional,
  },
  executive: {
    id: 'executive',
    name: 'Executive Impact',
    description: 'Leadership-focused format with impact-first bullets.',
    component: ExecutiveImpact,
  },
  technical: {
    id: 'technical',
    name: 'Technical Compact',
    description: 'Dense, engineer-friendly layout with grouped skills.',
    component: TechnicalCompact,
  },
  graduate: {
    id: 'graduate',
    name: 'Graduate Starter',
    description: 'Education-forward format with projects before experience.',
    component: GraduateStarter,
  },
} as const satisfies Record<string, TemplateConfig>;

export type TemplateId = keyof typeof templateRegistry;
export const templateList = Object.values(templateRegistry);
export const defaultTemplateId: TemplateId = 'classic';

export function resolveTemplateId(value: string, fallback: TemplateId = defaultTemplateId): TemplateId {
  const candidate = String(value || '').trim() as TemplateId;
  if (candidate && candidate in templateRegistry) {
    return candidate;
  }
  return fallback;
}

