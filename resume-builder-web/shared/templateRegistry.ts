import type { ComponentType } from 'react';
import type { ResumeImportResult, TemplateCatalogId, TemplateCatalogItem } from 'resume-builder-shared';
import { DEFAULT_TEMPLATE_ID, TEMPLATE_CATALOG, resolveTemplateCatalogId } from 'resume-builder-shared';
import ClassicATS from '@/components/templates/ClassicATS';
import ConsultantClean from '@/components/templates/ConsultantClean';
import ExecutiveImpact from '@/components/templates/ExecutiveImpact';
import MinimalClean from '@/components/templates/MinimalClean';
import ModernProfessional from '@/components/templates/ModernProfessional';
import TechnicalCompact from '@/components/templates/TechnicalCompact';

export type TemplateComponentProps = {
  resumeData: ResumeImportResult;
};

export type TemplateConfig = TemplateCatalogItem & {
  component: ComponentType<TemplateComponentProps>;
};

type TemplateComponentKey = TemplateCatalogItem['componentKey'];

const templateComponents: Record<TemplateComponentKey, ComponentType<TemplateComponentProps>> = {
  classic: ClassicATS,
  modern: ModernProfessional,
  executive: ExecutiveImpact,
  technical: TechnicalCompact,
  minimal: MinimalClean,
  consultant: ConsultantClean,
};

const templateEntries = TEMPLATE_CATALOG.map((template) => {
  return [template.id, { ...template, component: templateComponents[template.componentKey] }] as const;
});

export const templateRegistry = Object.fromEntries(templateEntries) as Record<TemplateCatalogId, TemplateConfig>;
export type TemplateId = keyof typeof templateRegistry;
export const templateList = TEMPLATE_CATALOG.map((template) => templateRegistry[template.id]);
export const defaultTemplateId: TemplateId = DEFAULT_TEMPLATE_ID;

export function resolveTemplateId(value: string, fallback: TemplateId = defaultTemplateId): TemplateId {
  return resolveTemplateCatalogId(value, fallback);
}

