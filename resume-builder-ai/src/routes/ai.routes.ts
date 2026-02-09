import { Router } from 'express';
import { AiCritiqueSchema, AiParseJdSchema, AiSkillGapSchema } from 'resume-builder-shared';
import { parseJobDescription } from '../services/jd-parser.service';
import { scoreResume } from '../services/resume-scoring.service';
import { critiqueResume } from '../services/resume-critique.service';
import { skillGapAnalysis } from '../services/skill-gap.service';

export const aiRouter = Router();

aiRouter.post('/parse-jd', async (req, res) => {
  const parsed = AiParseJdSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const result = await parseJobDescription(parsed.data.text);
  return res.json(result);
});

aiRouter.post('/score-resume', async (req, res) => {
  const parsed = AiSkillGapSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const result = await scoreResume(parsed.data.resumeText, {
    skills: [],
    responsibilities: [],
    seniority: 'mid',
  });
  return res.json(result);
});

aiRouter.post('/critique', async (req, res) => {
  const parsed = AiCritiqueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const result = await critiqueResume(parsed.data.resumeText, parsed.data.jdText);
  return res.json(result);
});

aiRouter.post('/skill-gap', async (req, res) => {
  const parsed = AiSkillGapSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const result = await skillGapAnalysis(parsed.data.resumeText, parsed.data.jdText);
  return res.json(result);
});
