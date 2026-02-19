import type { AtsScoreResult } from './api';

export const REVIEW_ATS_DEBOUNCE_MS = 650;

export function buildReviewAtsAttentionItems(result: AtsScoreResult | null | undefined) {
  if (!result) return [];
  const keywordMessage = result.missingKeywords.length
    ? `Missing keywords: ${result.missingKeywords.slice(0, 8).join(', ')}.`
    : '';
  const merged = [
    ...result.rejectionReasons,
    ...result.improvementSuggestions,
    keywordMessage,
  ]
    .map((item) => item.trim())
    .filter(Boolean);
  const deduped = Array.from(new Set(merged));
  return deduped.slice(0, 8);
}
