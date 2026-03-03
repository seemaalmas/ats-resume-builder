import type { ResumeDraft } from '@/src/lib/resume-store';
import { detectExperienceLevelFromResume, estimateExperienceMonths, getPopulatedSections } from '@/src/lib/resume-flow';
import { templates, type TemplateId } from '@/src/components/TemplatePreview';

export type TemplateRecommendation = {
  primaryTemplateId: TemplateId;
  reasons: string[];
  rankedTemplateIds: TemplateId[];
};

const ROLE_KEYWORDS: Record<string, TemplateId[]> = {
  product: ['modern'],
  design: ['modern', 'executive'],
  engineering: ['technical', 'modern'],
  data: ['technical'],
  ops: ['classic'],
};

export function recommendTemplates(resume: ResumeDraft): TemplateRecommendation {
  const detection = detectExperienceLevelFromResume(resume);
  const experienceMonths = estimateExperienceMonths(resume.experience);
  const experienceYears = experienceMonths / 12;
  const sectionCount = getPopulatedSections(resume).length;
  const skillCount = (
    (resume.skills || []).length +
    (resume.technicalSkills || []).length +
    (resume.softSkills || []).length +
    (resume.languages || []).length
  );

  const highlightCount = (resume.experience || []).reduce(
    (sum, entry) => sum + (entry.highlights?.filter(Boolean).length || 0),
    0,
  );
  const projectBullets = (resume.projects || []).reduce(
    (sum, project) => sum + (project.highlights?.filter(Boolean).length || 0),
    0,
  );
  const densityMetric = highlightCount + projectBullets + sectionCount * 2 + (resume.certifications?.length || 0) * 2;
  const estimatedPages = Math.max(1, Math.min(4, Math.ceil(densityMetric / 16)));

  const roleText = [
    resume.title,
    resume.summary,
    ...(resume.experience || []).map((item) => `${item.role} ${item.company}`),
    ...(resume.projects || []).map((item) => item.name),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const roleTraits = new Set<string>();
  if (/(product|pm|program manager)/.test(roleText)) roleTraits.add('product');
  if (/(design|ux|ui|creative|art director)/.test(roleText)) roleTraits.add('design');
  if (/(engineer|developer|software|tech|architect)/.test(roleText)) roleTraits.add('engineering');
  if (/(data|analytics|scientist|data engineer)/.test(roleText)) roleTraits.add('data');
  if (/(operations|ops|process)/.test(roleText)) roleTraits.add('ops');

  const baseOrder = templates.map((template, index) => ({ id: template.id, order: index }));
  const scores: Record<TemplateId, number> = {} as Record<TemplateId, number>;
  const reasonsByTemplate = new Map<TemplateId, string[]>();
  for (const entry of baseOrder) {
    scores[entry.id] = 0;
  }

  const bump = (id: TemplateId, delta: number, reason?: string) => {
    if (!(id in scores)) return;
    scores[id] += delta;
    if (reason) {
      const list = reasonsByTemplate.get(id) ?? [];
      if (!list.includes(reason) && list.length < 3) {
        list.push(reason);
        reasonsByTemplate.set(id, list);
      }
    }
  };

  if (experienceYears >= 8 || detection.level === 'SENIOR') {
    bump('executive', 28, 'Leadership-heavy profiles read best with impact-first sections.');
    bump('classic', 10);
    bump('modern', 8);
  }

  if ((resume.experience || []).length >= 4) {
    bump('executive', 10);
    bump('classic', 8);
  }

  if (skillCount >= 12 || (resume.certifications?.length || 0) >= 3) {
    bump('technical', 18, 'Skills-heavy profiles are easier to scan in the compact technical format.');
    bump('modern', 8);
  }

  if (estimatedPages >= 3) {
    bump('classic', 16, 'Dense resumes need a straightforward ATS-first single-column format.');
  } else if (estimatedPages <= 1) {
    bump('graduate', 8, 'Early-career resumes benefit from project-forward ordering.');
  }

  for (const trait of roleTraits) {
    const targets = ROLE_KEYWORDS[trait];
    if (!targets) continue;
    const reason =
      trait === 'design'
        ? 'Creative or design roles pair well with bold typography and contrast.'
        : trait === 'product'
          ? 'Product and strategy profiles pair well with modern section hierarchy.'
          : trait === 'engineering'
            ? 'Technical leadership stories stay readable inside a compact layout.'
          : trait === 'data'
              ? 'Data and analytics mindsets prefer a dense, informational layout.'
              : 'Operational roles benefit from structured ATS-safe single-column flow.';
    const boost = trait === 'product'
      ? 16
      : trait === 'design'
        ? 12
        : trait === 'engineering'
          ? 10
          : trait === 'data'
            ? 8
            : 8;
    for (const target of targets) {
      bump(target, boost, reason);
    }
  }

  const ordered = baseOrder
    .slice()
    .sort((a, b) => {
      if (scores[b.id] !== scores[a.id]) return scores[b.id] - scores[a.id];
      return a.order - b.order;
    });

  const primaryTemplateId = ordered[0]?.id ?? templates[0]?.id ?? 'classic';
  const reasons = reasonsByTemplate.get(primaryTemplateId) ?? [];
  if (!reasons.length) {
    reasons.push('Balanced layout chosen to keep your resume scannable.');
  }

  return {
    primaryTemplateId,
    reasons,
    rankedTemplateIds: ordered.map((item) => item.id),
  };
}



