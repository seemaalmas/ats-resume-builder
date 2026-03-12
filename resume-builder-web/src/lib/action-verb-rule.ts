export const ACTION_VERB_REQUIRED_RATIO = 0.6;

export const WEAK_STARTER_PHRASES = [
  'responsible for',
  'worked on',
  'work on',
  'working on',
  'helped',
  'assisted',
  'involved in',
  'tasked with',
  'participated in',
  'duties included',
  'was responsible for',
  'were responsible for',
  'supporting',
  'support',
  'handled',
  'handling',
  'did',
  'doing',
];

const STRONG_ACTION_VERBS = [
  'achieve','acquire','activate','adapt','administer','advise','align','analyze','architect','assemble',
  'assess','audit','automate','benchmark','boost','build','calibrate','capture','champion','clarify',
  'coach','collaborate','communicate','compose','conceive','conduct','configure','consolidate','construct','consult',
  'coordinate','craft','create','curate','customize','debug','define','delegate','deliver','demonstrate',
  'deploy','design','detect','develop','devise','diagnose','direct','discover','distribute','document',
  'drive','elevate','eliminate','enable','enforce','engineer','enhance','establish','evaluate','execute',
  'expand','expedite','explore','facilitate','forecast','formalize','formulate','found','generate','govern',
  'guide','harden','identify','implement','improve','increase','influence','initiate','innovate','inspect',
  'instruct','integrate','interpret','introduce','investigate','launch','lead','leverage','maintain','manage',
  'map','maximize','measure','mentor','migrate','minimize','modernize','model','monitor','negotiate',
  'operate','optimize','orchestrate','organize','overhaul','oversee','own','partner','perform','pilot',
  'plan','prepare','present','prioritize','produce','program','promote','propose','prototype','provide',
  'publish','qualify','quantify','rebuild','recommend','reconcile','redesign','reduce','refactor','refine',
  'reinforce','release','remediate','reorganize','replace','report','represent','research','resolve','respond',
  'restore','restructure','retain','retrieve','revamp','review','revise','rollout','run','scale',
  'schedule','secure','select','shape','ship','simplify','solve','spearhead','stabilize','standardize',
  'start','streamline','strengthen','structure','study','supervise','support','sustain','synthesize','tailor',
  'test','track','train','transform','translate','troubleshoot','unify','upgrade','validate','verify',
  'win','write','accelerate','accomplish','activate','administer','advance','aggregate','amplify','approve',
  'attain','authorize','balance','bridge','close','command','complete','compute','contribute','convert',
  'correct','decrease','deliver','digitize','educate','encourage','enrich','exceed','grow','increase',
  'institutionalize','mobilize','negotiate','outperform','pioneer','position','raise','realign','recover','reimagine',
  'relaunch','renew','replatform','revitalize','scaffold','sequence','solidify','specify','succeed','surpass',
  'synchronize','triage','uplift','visualize','accelerate','adopt','aggregate','blend','bridge','co-create',
  'combine','compare','compile','compose','conceptualize','configure','connect','contextualize','converge','decode',
  'differentiate','disentangle','disrupt','draft','evolve','expand','experiment','extract','feature','fine-tune',
  'harness','head','ideate','index','inspire','institutionalize','iterate','join','kickstart','merge',
  'operationalize','perfect','personalize','reframe','retool','schedule','safeguard','segment','storyboard','surface',
];

const IRREGULAR_VERB_LEMMAS: Record<string, string> = {
  led: 'lead',
  built: 'build',
  drove: 'drive',
  run: 'run',
  ran: 'run',
  written: 'write',
  wrote: 'write',
  won: 'win',
  made: 'make',
  took: 'take',
  begun: 'begin',
  began: 'begin',
  seen: 'see',
  saw: 'see',
  grown: 'grow',
  grew: 'grow',
  known: 'know',
  paid: 'pay',
  kept: 'keep',
  thought: 'think',
  brought: 'bring',
  found: 'find',
  chose: 'choose',
  chosen: 'choose',
  gave: 'give',
  given: 'give',
};

const NON_VERB_STARTERS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'our', 'their', 'your',
  'team', 'teams', 'project', 'projects', 'platform', 'product', 'products', 'system', 'systems',
  'initiative', 'initiatives', 'work', 'worked', 'working', 'responsible', 'assisted', 'helped',
  'involved', 'experience', 'experiences', 'role', 'roles', 'duty', 'duties', 'support', 'supporting',
]);

const BULLET_PREFIX_RE = /^\s*(?:[•◦▪●*+-]+|\d{1,3}[.)]|[a-z][.)])\s*/i;
const BULLET_LABEL_PREFIX_RE = /^(impact|achievement|result|highlights?|accomplishment)s?:\s*/i;
const STRONG_VERB_SET = buildStrongVerbSet();

export type ExperienceBulletEntry = {
  expIndex: number;
  highlightIndex: number;
  text: string;
};

export type ActionVerbRuleFailure = {
  expIndex: number;
  highlightIndex: number;
  text: string;
  reason: 'weak_starter' | 'not_strong_enough';
  suggestions: string[];
};

export type ActionVerbRuleState = {
  requiredRatio: number;
  totalBullets: number;
  strongBullets: number;
  requiredStrongBullets: number;
  remainingToPass: number;
  percentage: number;
  passes: boolean;
  failures: ActionVerbRuleFailure[];
  message: string;
};

export function createActionVerbRuleState(
  entries: ExperienceBulletEntry[],
  requiredRatio = ACTION_VERB_REQUIRED_RATIO,
): ActionVerbRuleState {
  const normalizedEntries = (entries || [])
    .map((entry) => ({
      expIndex: entry.expIndex,
      highlightIndex: entry.highlightIndex,
      text: String(entry.text || '').trim(),
    }))
    .filter((entry) => entry.text.length > 0);

  if (!normalizedEntries.length) {
    return {
      requiredRatio,
      totalBullets: 0,
      strongBullets: 0,
      requiredStrongBullets: 0,
      remainingToPass: 0,
      percentage: 0,
      passes: true,
      failures: [],
      message: '',
    };
  }

  const failures: ActionVerbRuleFailure[] = [];
  let strongBullets = 0;
  for (const entry of normalizedEntries) {
    const verdict = evaluateBulletStarter(entry.text);
    if (verdict.accepted) {
      strongBullets += 1;
      continue;
    }
    failures.push({
      expIndex: entry.expIndex,
      highlightIndex: entry.highlightIndex,
      text: entry.text,
      reason: verdict.reason,
      suggestions: buildStarterSuggestions(entry.text),
    });
  }

  const totalBullets = normalizedEntries.length;
  const requiredStrongBullets = Math.ceil(totalBullets * requiredRatio);
  const remainingToPass = Math.max(0, requiredStrongBullets - strongBullets);
  const percentage = totalBullets ? Math.round((strongBullets / totalBullets) * 100) : 0;
  const passes = remainingToPass === 0;
  const thresholdPercent = Math.round(requiredRatio * 100);

  return {
    requiredRatio,
    totalBullets,
    strongBullets,
    requiredStrongBullets,
    remainingToPass,
    percentage,
    passes,
    failures,
    message: passes
      ? `Strong action verb coverage is ${percentage}% (${strongBullets}/${totalBullets}) bullets.`
      : `At least ${thresholdPercent}% of experience bullets must start with a strong action verb. Currently ${percentage}% (${strongBullets}/${totalBullets}). Fix ${remainingToPass} more bullet${remainingToPass === 1 ? '' : 's'} to reach ${thresholdPercent}%.`,
  };
}

export function getActionVerbFailure(
  state: ActionVerbRuleState,
  expIndex: number,
  highlightIndex: number,
) {
  return state.failures.find((item) => item.expIndex === expIndex && item.highlightIndex === highlightIndex) || null;
}

export function normalizeBulletText(input: string) {
  let value = String(input || '');
  while (BULLET_PREFIX_RE.test(value)) {
    value = value.replace(BULLET_PREFIX_RE, '');
  }
  while (BULLET_LABEL_PREFIX_RE.test(value.trimStart())) {
    value = value.trimStart().replace(BULLET_LABEL_PREFIX_RE, '');
  }
  return value
    .replace(/^[`"'([{]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function replaceBulletStarter(bullet: string, selectedVerb: string) {
  const safeVerb = String(selectedVerb || '').trim();
  if (!safeVerb) return String(bullet || '');

  const raw = String(bullet || '');
  const prefixMatch = raw.match(/^\s*(?:[•◦▪●*+-]+|\d{1,3}[.)]|[a-z][.)])\s*/i);
  const preservedPrefix = prefixMatch ? prefixMatch[0] : '';
  const normalized = normalizeBulletText(raw);
  if (!normalized) return `${preservedPrefix}${capitalizeWord(safeVerb)}`.trim();

  const lower = normalized.toLowerCase();
  let rest = normalized;
  const weakMatch = WEAK_STARTER_PHRASES.find((phrase) => lower.startsWith(phrase));
  if (weakMatch) {
    rest = normalized.slice(weakMatch.length).trim();
  } else {
    rest = normalized.replace(/^[^\s]+/, '').trim();
  }
  const output = rest ? `${capitalizeWord(safeVerb)} ${rest}` : capitalizeWord(safeVerb);
  return `${preservedPrefix}${output}`.trim();
}

function evaluateBulletStarter(bullet: string): { accepted: boolean; reason: 'weak_starter' | 'not_strong_enough' } {
  const normalized = normalizeBulletText(bullet);
  if (!normalized) return { accepted: false, reason: 'not_strong_enough' };
  if (isWeakStarter(normalized)) return { accepted: false, reason: 'weak_starter' };

  const firstToken = normalized.split(/\s+/)[0] || '';
  const lemma = normalizeVerbToken(firstToken);
  if (lemma && STRONG_VERB_SET.has(lemma)) return { accepted: true, reason: 'not_strong_enough' };
  if (looksLikeStrongVerbHeuristic(firstToken, normalized)) return { accepted: true, reason: 'not_strong_enough' };
  return { accepted: false, reason: 'not_strong_enough' };
}

function buildStarterSuggestions(bullet: string, limit = 6) {
  const text = normalizeBulletText(bullet).toLowerCase();
  const suggestions: string[] = [];

  if (/(optimiz|performance|latency|speed|efficien|throughput|cost|scal)/.test(text)) {
    suggestions.push('Optimized', 'Improved', 'Enhanced', 'Streamlined');
  }
  if (/(led|leader|managed|team|mentored|stakeholder|cross-functional|ownership|directed)/.test(text)) {
    suggestions.push('Led', 'Managed', 'Mentored', 'Directed');
  }
  if (/(built|develop|implement|engineer|architect|design|create|launched|deployed)/.test(text)) {
    suggestions.push('Built', 'Implemented', 'Developed', 'Engineered');
  }
  if (!suggestions.length) {
    suggestions.push('Delivered', 'Built', 'Implemented', 'Improved', 'Led', 'Designed');
  }
  return dedupeStrings(suggestions).slice(0, Math.max(3, Math.min(limit, 6)));
}

function isWeakStarter(bullet: string) {
  const normalized = normalizeBulletText(bullet).toLowerCase();
  if (!normalized) return false;
  return WEAK_STARTER_PHRASES.some((phrase) => normalized.startsWith(phrase));
}

function normalizeVerbToken(token: string) {
  return normalizeVerbTokenInternal(token, STRONG_VERB_SET);
}

function normalizeVerbTokenInternal(token: string, strongVerbSet?: Set<string>) {
  const clean = String(token || '')
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!clean) return '';

  const irregular = IRREGULAR_VERB_LEMMAS[clean];
  if (irregular) return irregular;

  const candidates = new Set<string>([clean]);
  if (clean.endsWith('ies') && clean.length > 4) candidates.add(`${clean.slice(0, -3)}y`);
  if (clean.endsWith('ied') && clean.length > 4) candidates.add(`${clean.slice(0, -3)}y`);
  if (clean.endsWith('ing') && clean.length > 5) {
    const base = clean.slice(0, -3);
    candidates.add(base);
    candidates.add(`${base}e`);
    if (/(.)\1$/.test(base)) candidates.add(base.slice(0, -1));
  }
  if (clean.endsWith('ed') && clean.length > 4) {
    const base = clean.slice(0, -2);
    candidates.add(base);
    candidates.add(`${base}e`);
    if (/(.)\1$/.test(base)) candidates.add(base.slice(0, -1));
  }
  if (clean.endsWith('es') && clean.length > 4) {
    candidates.add(clean.slice(0, -2));
    candidates.add(clean.slice(0, -1));
  }
  if (clean.endsWith('s') && clean.length > 3) {
    candidates.add(clean.slice(0, -1));
  }

  for (const candidate of candidates) {
    if (strongVerbSet && strongVerbSet.has(candidate)) {
      return candidate;
    }
    if (IRREGULAR_VERB_LEMMAS[candidate]) {
      return IRREGULAR_VERB_LEMMAS[candidate];
    }
  }

  if (candidates.has(clean)) return clean;
  return clean;
}

function looksLikeStrongVerbHeuristic(firstToken: string, normalizedBullet: string) {
  const token = String(firstToken || '')
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!token || token.length < 4) return false;
  if (NON_VERB_STARTERS.has(token)) return false;
  if (WEAK_STARTER_PHRASES.some((phrase) => normalizedBullet.toLowerCase().startsWith(phrase))) {
    return false;
  }
  if (/^[a-z]{4,}(ed|ing|ized|ised|ated|ified)$/.test(token)) return true;
  if (/^[a-z]{4,}(ize|ise|ate|ify|en)$/.test(token)) return true;
  if (/^[a-z]{4,}s$/.test(token) && !token.endsWith('ss')) return true;
  return false;
}

function buildStrongVerbSet() {
  const set = new Set<string>();
  for (const verb of STRONG_ACTION_VERBS) {
    const normalized = normalizeVerbTokenInternal(verb);
    if (normalized) set.add(normalized);
  }
  return set;
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values || []) {
    const clean = String(value || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

function capitalizeWord(value: string) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}
