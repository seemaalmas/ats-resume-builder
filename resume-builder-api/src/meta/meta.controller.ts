import { Controller, Get, Query } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';

type SeedPayload = {
  _note?: string;
  items?: string[];
};

type SkillType = 'technical' | 'soft';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

const institutionsSeed = loadSeedFile('institutions_in_seed.json');
const technicalSkillsSeed = loadSeedFile('skills_technical_seed.json');
const softSkillsSeed = loadSeedFile('skills_soft_seed.json');
const certificationsSeed = loadSeedFile('certifications_seed.json');

@Controller('meta')
export class MetaController {
  @Get('suggest/institutions')
  suggestInstitutions(
    @Query('q') query = '',
    @Query('limit') limitRaw?: string,
  ) {
    const limit = normalizeLimit(limitRaw);
    return {
      items: rankSuggestions(institutionsSeed, query, limit),
    };
  }

  @Get('suggest/skills')
  suggestSkills(
    @Query('q') query = '',
    @Query('type') typeRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const type = normalizeSkillType(typeRaw);
    const limit = normalizeLimit(limitRaw);
    const source = type === 'soft' ? softSkillsSeed : technicalSkillsSeed;
    return {
      items: rankSuggestions(source, query, limit),
    };
  }

  @Get('suggest/certifications')
  suggestCertifications(
    @Query('q') query = '',
    @Query('limit') limitRaw?: string,
  ) {
    const limit = normalizeLimit(limitRaw);
    return {
      items: rankSuggestions(certificationsSeed, query, limit),
    };
  }
}

function normalizeSkillType(typeRaw?: string): SkillType {
  const value = String(typeRaw || '').trim().toLowerCase();
  return value === 'soft' ? 'soft' : 'technical';
}

function normalizeLimit(limitRaw?: string) {
  const parsed = Number(limitRaw);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.round(parsed)));
}

function loadSeedFile(fileName: string) {
  const filePath = path.resolve(process.cwd(), 'src/data', fileName);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as SeedPayload;
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return dedupe(items);
  } catch {
    return [];
  }
}

function rankSuggestions(source: string[], query: string, limit: number) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return source.slice(0, limit);
  }
  const queryTokens = tokenize(normalizedQuery);
  return source
    .map((item) => ({ item, score: scoreCandidate(item, normalizedQuery, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.localeCompare(b.item);
    })
    .slice(0, limit)
    .map((entry) => entry.item);
}

function scoreCandidate(candidate: string, normalizedQuery: string, queryTokens: string[]) {
  const value = normalize(candidate);
  if (!value) return 0;
  if (value.startsWith(normalizedQuery)) return 300;
  if (value.includes(normalizedQuery)) return 200;

  const valueTokens = tokenize(value);
  const tokenOverlap = queryTokens.filter((token) => valueTokens.some((sourceToken) => sourceToken.includes(token))).length;
  if (tokenOverlap > 0) return 100 + tokenOverlap;
  return 0;
}

function normalize(value: string) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string) {
  return value
    .split(/[\s-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function dedupe(items: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const value = String(item || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}
