import type { AtsScoreResult } from './api';

export const REVIEW_ATS_DEBOUNCE_MS = 650;

export type ReviewAtsSuggestionSection = {
  title: string;
  body?: string;
  actionText?: string;
  items: string[];
  examples?: string[];
};

const TARGET_ROLE_PREFIX = 'Missing target-role signals:';
const KEYWORD_PREFIX = 'Show these target keywords in your Summary, Experience, or Skills:';
const TARGET_ROLE_ACTION_TEXT = 'Add leadership examples in Summary or Experience if accurate.';
const TARGET_ROLE_IMPROVEMENTS = [
  'Add one summary line showing leadership scope if accurate.',
  'Add 1-2 recent bullets showing team ownership.',
  'Mention mentoring, delivery ownership, stakeholder coordination, or planning if true.',
];
const TARGET_ROLE_EXAMPLES = [
  'Led a team of 6 engineers to deliver customer-facing features',
  'Owned sprint planning, task delegation, and delivery tracking',
  'Mentored junior developers and coordinated with product and QA teams',
];

export function buildReviewAtsSuggestionSections(result: AtsScoreResult | null | undefined): ReviewAtsSuggestionSection[] {
  if (!result) return [];

  const sections: ReviewAtsSuggestionSection[] = [];
  const normalizedSuggestions = result.improvementSuggestions.map((item) => item.trim()).filter(Boolean);
  const targetRoleSuggestion = normalizedSuggestions.find((item) => item.startsWith(TARGET_ROLE_PREFIX));
  const keywordSuggestion = normalizedSuggestions.find((item) => item.startsWith(KEYWORD_PREFIX));

  const targetRoles = parseSuggestionList(targetRoleSuggestion, TARGET_ROLE_PREFIX);
  const targetRoleTokens = new Set(targetRoles.flatMap((role) => tokenizeListValue(role)));
  const filteredMissingKeywords = result.missingKeywords.filter((keyword) => !targetRoleTokens.has(keyword.toLowerCase()));

  if (targetRoles.length) {
    sections.push({
      title: 'Missing target-role signals',
      body: `Your target roles include ${joinForBody(targetRoles)}, but your resume does not clearly show those terms or equivalent leadership signals.`,
      actionText: TARGET_ROLE_ACTION_TEXT,
      items: TARGET_ROLE_IMPROVEMENTS,
      examples: TARGET_ROLE_EXAMPLES,
    });
  }

  const keywordLabels = keywordSuggestion
    ? parseSuggestionList(keywordSuggestion, KEYWORD_PREFIX)
    : filteredMissingKeywords.slice(0, 8);
  if (keywordLabels.length) {
    sections.push({
      title: 'Missing keywords',
      body: keywordSuggestion || `${KEYWORD_PREFIX} ${keywordLabels.join(', ')}.`,
      items: [],
    });
  }

  const remainingSuggestions = normalizedSuggestions.filter(
    (item) => item !== targetRoleSuggestion && item !== keywordSuggestion,
  );
  if (remainingSuggestions.length) {
    sections.push({
      title: 'Suggested resume improvements',
      items: Array.from(new Set(remainingSuggestions)),
    });
  }

  return sections;
}

export function buildReviewAtsAttentionItems(result: AtsScoreResult | null | undefined) {
  if (!result) return [];
  const sections = buildReviewAtsSuggestionSections(result);
  const merged = [
    ...result.rejectionReasons,
    ...sections.flatMap((section) => [
      section.body || '',
      section.actionText || '',
      ...section.items,
    ]),
  ]
    .map((item) => item.trim())
    .filter(Boolean);
  const deduped = Array.from(new Set(merged));
  return deduped.slice(0, 8);
}

function parseSuggestionList(value: string | undefined, prefix: string) {
  if (!value) return [];
  const withoutPrefix = value.slice(prefix.length).trim().replace(/[.]+$/, '');
  if (!withoutPrefix) return [];
  return withoutPrefix
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function tokenizeListValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function joinForBody(values: string[]) {
  if (!values.length) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`;
}
