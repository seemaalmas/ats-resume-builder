const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ACTION_VERB_REQUIRED_RATIO,
  analyzeActionVerbRule,
  buildStarterSuggestions,
  isAcceptedStrongStarter,
  isWeakStarter,
  normalizeBulletText,
  replaceBulletStarter,
} = require('../dist/resume/action-verb-rule.js');

test('normalizes bullets with symbols and numbering', () => {
  assert.equal(normalizeBulletText('\u2022 Built a release pipeline'), 'Built a release pipeline');
  assert.equal(normalizeBulletText('- Implemented SSR rendering'), 'Implemented SSR rendering');
  assert.equal(normalizeBulletText('1. Led platform migration'), 'Led platform migration');
  assert.equal(normalizeBulletText('Impact: Led platform migration'), 'Led platform migration');
  assert.equal(normalizeBulletText('- Achievement: Built SSR rendering'), 'Built SSR rendering');
});

test('weak starter detection rejects responsible/worked starters', () => {
  assert.equal(isWeakStarter('Responsible for handling release tasks'), true);
  assert.equal(isWeakStarter('Worked on production incidents'), true);
  assert.equal(isWeakStarter('Led a team of engineers'), false);
});

test('strong starter detection accepts configured strong verbs', () => {
  assert.equal(isAcceptedStrongStarter('Built a reusable design system'), true);
  assert.equal(isAcceptedStrongStarter('Implemented API caching across services'), true);
});

test('strong starter detection accepts reasonable non-listed verbs via heuristic', () => {
  assert.equal(isAcceptedStrongStarter('Galvanized cross-team ownership to accelerate delivery'), true);
});

test('action-verb ratio boundaries pass at 60% and fail below 60%', () => {
  const passing = analyzeActionVerbRule([
    'Built platform modules for API delivery',
    'Implemented observability checks',
    'Responsible for release notes',
    'Worked on QA handoffs',
    'Led sprint planning improvements',
  ], ACTION_VERB_REQUIRED_RATIO);
  assert.equal(passing.strongBullets, 3);
  assert.equal(passing.totalBullets, 5);
  assert.equal(passing.percentage, 60);
  assert.equal(passing.passes, true);

  const failing = analyzeActionVerbRule([
    'Built platform modules for API delivery',
    'Responsible for release notes',
    'Worked on QA handoffs',
    'Assisted with sprint planning',
    'Handled stakeholder communication',
  ], ACTION_VERB_REQUIRED_RATIO);
  assert.equal(failing.strongBullets, 1);
  assert.equal(failing.totalBullets, 5);
  assert.equal(failing.passes, false);
  assert.equal(failing.remainingToPass, 2);
});

test('suggestion generation uses contextual keywords', () => {
  const perf = buildStarterSuggestions('Responsible for performance optimization and latency reduction');
  assert.ok(perf.includes('Optimized'));
  assert.ok(perf.includes('Improved'));

  const leadership = buildStarterSuggestions('Worked on mentoring team members and managing stakeholders');
  assert.ok(leadership.includes('Led'));
  assert.ok(leadership.includes('Managed'));
});

test('replace bullet starter swaps weak phrase with selected strong verb', () => {
  const replaced = replaceBulletStarter('Responsible for optimizing API latency by 30%', 'Optimized');
  assert.equal(replaced, 'Optimized optimizing API latency by 30%');
});


