export type TemplateCatalogId =
  | 'classic'
  | 'modern'
  | 'executive'
  | 'technical'
  | 'minimal'
  | 'consultant';

export type TemplateCatalogItem = {
  id: TemplateCatalogId;
  name: string;
  description: string;
  tags: string[];
  recommendedFor?: string[];
  componentKey: TemplateCatalogId;
  isDefault?: boolean;
};

export const TEMPLATE_CATALOG: readonly TemplateCatalogItem[] = [
  {
    id: 'classic',
    name: 'Classic ATS',
    description: 'Single-column ATS-safe structure with bold section headers.',
    tags: ['ATS-safe', 'Single-column', 'Default'],
    recommendedFor: ['General professional resumes', 'High ATS compatibility'],
    componentKey: 'classic',
    isDefault: true,
  },
  {
    id: 'modern',
    name: 'Modern Professional',
    description: 'Clean modern spacing with subtle divider lines and ATS-safe semantics.',
    tags: ['ATS-safe', 'Modern (ATS-safe)'],
    recommendedFor: ['Product', 'Operations', 'Business-facing roles'],
    componentKey: 'modern',
  },
  {
    id: 'executive',
    name: 'Executive Impact',
    description: 'Leadership-focused hierarchy with strong, results-first bullet structure.',
    tags: ['ATS-safe', 'Leadership'],
    recommendedFor: ['Senior IC', 'Manager', 'Director'],
    componentKey: 'executive',
  },
  {
    id: 'technical',
    name: 'Technical Compact',
    description: 'Dense but readable ATS-safe layout with grouped technical skills.',
    tags: ['ATS-safe', 'Engineering'],
    recommendedFor: ['Engineering', 'Data', 'Platform teams'],
    componentKey: 'technical',
  },
  {
    id: 'minimal',
    name: 'Minimal Clean',
    description: 'Ultra-minimal recruiter-friendly format with precise section rhythm.',
    tags: ['ATS-safe', 'Minimal (ATS-safe)'],
    recommendedFor: ['Early-career', 'One-page resumes'],
    componentKey: 'minimal',
  },
  {
    id: 'consultant',
    name: 'Consultant Clean',
    description: 'Crisp headings and metric-forward bullet readability in single-column flow.',
    tags: ['ATS-safe', 'Consulting style'],
    recommendedFor: ['Consulting', 'Strategy', 'Client delivery'],
    componentKey: 'consultant',
  },
] as const;

export const DEFAULT_TEMPLATE_ID: TemplateCatalogId =
  (TEMPLATE_CATALOG.find((template) => template.isDefault)?.id as TemplateCatalogId | undefined) || 'classic';

const TEMPLATE_ID_SET = new Set<TemplateCatalogId>(TEMPLATE_CATALOG.map((template) => template.id));

const TEMPLATE_ID_ALIASES: Record<string, TemplateCatalogId> = {
  student: 'minimal',
  graduate: 'minimal',
  'graduate-starter': 'minimal',
  'modern-professional': 'modern',
  'classic-ats': 'classic',
  'executive-impact': 'executive',
  'technical-compact': 'technical',
  'minimal-clean': 'minimal',
  'consultant-clean': 'consultant',
};

export function isTemplateCatalogId(value: string): value is TemplateCatalogId {
  return TEMPLATE_ID_SET.has(value as TemplateCatalogId);
}

export function resolveTemplateCatalogId(value: string, fallback: TemplateCatalogId = DEFAULT_TEMPLATE_ID): TemplateCatalogId {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  const candidate = TEMPLATE_ID_ALIASES[normalized] || normalized;
  if (isTemplateCatalogId(candidate)) {
    return candidate;
  }
  return fallback;
}
