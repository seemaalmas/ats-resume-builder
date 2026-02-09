export const jdParsingPrompt = `Extract the key skills, tools, and responsibilities from the job description. Return JSON with keys: skills (string[]), responsibilities (string[]), seniority (string). Keep output concise.`;

export const resumeScoringPrompt = `Score a resume against a job summary. Return JSON with keys: score (number 0-100), suggestions (string[]).`;

export const resumeCritiquePrompt = `Provide a short resume critique. Return JSON with keys: highlights (string[]), weaknesses (string[]), rewrittenSummary (string). Keep each list to max 5 items.`;

export const skillGapPrompt = `Given resume and JD, list missing skills and recommended keywords. Return JSON with keys: missingSkills (string[]), recommendedKeywords (string[]).`;
