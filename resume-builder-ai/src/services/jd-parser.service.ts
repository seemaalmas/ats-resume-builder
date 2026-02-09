import type { JdParseResult } from 'resume-builder-shared';
import { getLlmProvider } from '../providers/provider-factory';
import { jdParsingPrompt } from '../prompts/templates';

const fallbackSkills = ['communication', 'teamwork', 'problem solving'];

export async function parseJobDescription(text: string): Promise<JdParseResult> {
  const provider = getLlmProvider();
  const completion = await provider.complete({
    model: 'mock-gpt',
    temperature: 0.2,
    messages: [
      { role: 'system', content: jdParsingPrompt },
      { role: 'user', content: trimToMaxChars(text, 3000) },
    ],
  });

  const skills = extractKeywords(text);
  return {
    skills: skills.length ? skills : fallbackSkills,
    responsibilities: extractResponsibilities(text),
    seniority: inferSeniority(text + completion.content),
  };
}

function extractKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const stop = new Set(['and', 'the', 'with', 'for', 'you', 'our', 'are', 'will', 'from', 'that']);
  const freq = new Map<string, number>();
  for (const t of tokens) {
    if (stop.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([t]) => t);
}

function extractResponsibilities(text: string): string[] {
  return text
    .split(/\n|\./)
    .map((s) => s.trim())
    .filter((s) => s.length > 15)
    .slice(0, 6);
}

function inferSeniority(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('senior') || t.includes('lead') || t.includes('principal')) return 'senior';
  if (t.includes('mid') || t.includes('intermediate')) return 'mid';
  if (t.includes('junior') || t.includes('entry') || t.includes('graduate')) return 'junior';
  return 'mid';
}

function trimToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
