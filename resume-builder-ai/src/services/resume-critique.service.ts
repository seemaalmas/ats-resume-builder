import type { ResumeCritiqueResult } from 'resume-builder-shared';
import { getLlmProvider } from '../providers/provider-factory';
import { resumeCritiquePrompt } from '../prompts/templates';

export async function critiqueResume(resumeText: string, jdText?: string): Promise<ResumeCritiqueResult> {
  const provider = getLlmProvider();
  await provider.complete({
    model: 'mock-gpt',
    temperature: 0.2,
    messages: [
      { role: 'system', content: resumeCritiquePrompt },
      { role: 'user', content: `${trimToMaxChars(resumeText, 4000)}\n\n${jdText ? `JD: ${trimToMaxChars(jdText, 3000)}` : ''}` },
    ],
  });

  return {
    highlights: pickHighlights(resumeText),
    weaknesses: pickWeaknesses(resumeText),
    rewrittenSummary: rewriteSummary(resumeText),
  };
}

function pickHighlights(text: string): string[] {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, 3).map((l) => `Strong: ${l.slice(0, 80)}`);
}

function pickWeaknesses(text: string): string[] {
  if (text.length < 200) {
    return ['Resume is too short; expand key achievements and skills.'];
  }
  if (!/\d/.test(text)) {
    return ['Add quantified impact (metrics, percentages, or numbers).'];
  }
  return ['Consider adding more role-specific keywords from the JD.'];
}

function rewriteSummary(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 180) + (cleaned.length > 180 ? '...' : '');
}

function trimToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
