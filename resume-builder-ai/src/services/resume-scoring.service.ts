import type { JobDescriptionSummary, ResumeScoreResult } from 'resume-builder-shared';
import { getLlmProvider } from '../providers/provider-factory';
import { resumeScoringPrompt } from '../prompts/templates';

export async function scoreResume(resumeText: string, jdSummary: JobDescriptionSummary): Promise<ResumeScoreResult> {
  const provider = getLlmProvider();
  await provider.complete({
    model: 'mock-gpt',
    temperature: 0.2,
    messages: [
      { role: 'system', content: resumeScoringPrompt },
      { role: 'user', content: `${resumeText}\n\nJD Summary: ${JSON.stringify(jdSummary)}` },
    ],
  });

  const resumeTokens = tokenize(resumeText);
  const matchedSkills = jdSummary.skills.filter((s) => resumeTokens.has(s.toLowerCase()));
  const missingSkills = jdSummary.skills.filter((s) => !resumeTokens.has(s.toLowerCase()));
  const score = Math.max(10, Math.min(100, Math.round((matchedSkills.length / Math.max(1, jdSummary.skills.length)) * 100)));

  const suggestions = [
    missingSkills.length ? `Add evidence of ${missingSkills.slice(0, 5).join(', ')}.` : 'Skills alignment looks solid.',
    'Use strong action verbs and quantify impact where possible.',
    jdSummary.seniority === 'junior'
      ? 'Highlight projects, internships, and coursework relevant to the JD.'
      : 'Emphasize leadership, ownership, and measurable outcomes.',
  ];

  return { score, suggestions, matchedSkills, missingSkills };
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
