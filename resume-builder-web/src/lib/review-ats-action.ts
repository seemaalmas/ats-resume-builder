import type { AtsScoreResult } from './api';

export type CheckAtsScoreInput = {
  resumeId: string;
  jdText?: string;
  previousScore: AtsScoreResult | null;
  score: (resumeId: string, jdText?: string) => Promise<AtsScoreResult>;
};

export type CheckAtsScoreResult =
  | { ok: true; score: AtsScoreResult; error: '' }
  | { ok: false; score: AtsScoreResult | null; error: string };

export async function checkAtsScore(input: CheckAtsScoreInput): Promise<CheckAtsScoreResult> {
  const resumeId = String(input.resumeId || '').trim();
  if (!resumeId) {
    return { ok: false, score: input.previousScore, error: 'Save first to score.' };
  }
  try {
    const result = await input.score(resumeId, input.jdText || undefined);
    return { ok: true, score: result, error: '' };
  } catch (err: unknown) {
    const fallbackError = err instanceof Error ? err.message : 'Could not compute ATS score.';
    return { ok: false, score: input.previousScore, error: fallbackError };
  }
}
