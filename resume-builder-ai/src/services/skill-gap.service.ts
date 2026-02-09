import type { SkillGapResult } from 'resume-builder-shared';
import { getLlmProvider } from '../providers/provider-factory';
import { skillGapPrompt } from '../prompts/templates';

export async function skillGapAnalysis(resumeText: string, jdText: string): Promise<SkillGapResult> {
  const provider = getLlmProvider();
  await provider.complete({
    model: 'mock-gpt',
    temperature: 0.2,
    messages: [
      { role: 'system', content: skillGapPrompt },
      { role: 'user', content: `${trimToMaxChars(resumeText, 3500)}\n\nJD: ${trimToMaxChars(jdText, 3000)}` },
    ],
  });

  const resumeTokens = tokenize(resumeText);
  const jdKeywords = extractKeywords(jdText, 16);
  const missingSkills = jdKeywords.filter((k) => !resumeTokens.has(k));

  return {
    missingSkills,
    recommendedKeywords: jdKeywords.slice(0, 10),
  };
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function extractKeywords(text: string, limit: number): string[] {
  const tokens = Array.from(tokenize(text)).filter((t) => t.length > 2);
  const stop = new Set(['and', 'the', 'with', 'for', 'you', 'our', 'are', 'will', 'from', 'that', 'this', 'your']);
  const freq = new Map<string, number>();
  for (const t of tokens) {
    if (stop.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t);
}

function trimToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
