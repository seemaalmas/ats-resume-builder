import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTION_VERB_REQUIRED_RATIO,
  createActionVerbRuleState,
  getActionVerbFailure,
  replaceBulletStarter,
  type ExperienceBulletEntry,
} from '../src/lib/action-verb-rule';

function entries(values: string[]): ExperienceBulletEntry[] {
  return values.map((text, index) => ({
    expIndex: 0,
    highlightIndex: index,
    text,
  }));
}

test('action-verb warning state updates from failing to passing as bullets are edited', () => {
  const failingState = createActionVerbRuleState(entries([
    'Responsible for optimizing latency by 30%.',
    'Built deployment automation for production releases.',
  ]), ACTION_VERB_REQUIRED_RATIO);

  assert.equal(failingState.passes, false);
  assert.equal(failingState.percentage, 50);
  assert.match(failingState.message, /Currently 50% \(1\/2\)/i);

  const firstFailure = getActionVerbFailure(failingState, 0, 0);
  assert.ok(firstFailure);
  assert.ok(firstFailure!.suggestions.length > 0);

  const updatedBullet = replaceBulletStarter('Responsible for optimizing latency by 30%.', firstFailure!.suggestions[0]);
  const passingState = createActionVerbRuleState(entries([
    updatedBullet,
    'Built deployment automation for production releases.',
  ]), ACTION_VERB_REQUIRED_RATIO);

  assert.equal(passingState.passes, true);
  assert.equal(passingState.percentage, 100);
  assert.equal(passingState.failures.length, 0);
  assert.match(passingState.message, /100% \(2\/2\)/i);
});

test('action-verb state accepts strong non-listed verbs via heuristic', () => {
  const result = createActionVerbRuleState(entries([
    'Galvanized cross-team ownership to accelerate release delivery.',
  ]), ACTION_VERB_REQUIRED_RATIO);

  assert.equal(result.passes, true);
  assert.equal(result.strongBullets, 1);
  assert.equal(result.totalBullets, 1);
});

test('action-verb state respects the 60% boundary', () => {
  const passing = createActionVerbRuleState(entries([
    'Built reusable components for dashboards.',
    'Implemented rollout safeguards in CI.',
    'Led release management planning.',
    'Worked on sprint handoffs.',
    'Assisted with incident follow-ups.',
  ]), ACTION_VERB_REQUIRED_RATIO);
  assert.equal(passing.percentage, 60);
  assert.equal(passing.passes, true);

  const failing = createActionVerbRuleState(entries([
    'Built reusable components for dashboards.',
    'Worked on sprint handoffs.',
    'Assisted with incident follow-ups.',
    'Responsible for documentation updates.',
    'Handled release scheduling.',
  ]), ACTION_VERB_REQUIRED_RATIO);
  assert.equal(failing.passes, false);
  assert.equal(failing.remainingToPass, 2);
});
