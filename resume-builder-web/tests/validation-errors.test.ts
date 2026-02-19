import assert from 'node:assert/strict';
import test from 'node:test';
import { hasFieldPrefix, toFieldErrorMap } from '../src/lib/validation-errors';

test('backend 422 field paths map to experience bullet inputs for highlighting', () => {
  const mapped = toFieldErrorMap([
    {
      path: 'experience[0].highlights[2]',
      message: 'Start this bullet with a strong action verb.',
    },
    {
      path: 'experience.1.highlights.0',
      message: 'Start this bullet with a strong action verb.',
    },
  ]);

  assert.equal(
    mapped['experience[0].highlights[2]'],
    'Start this bullet with a strong action verb.',
  );
  assert.equal(
    mapped['experience.0.highlights.2'],
    'Start this bullet with a strong action verb.',
  );
  assert.equal(
    mapped['experience[1].highlights[0]'],
    'Start this bullet with a strong action verb.',
  );
  assert.equal(hasFieldPrefix(mapped, 'experience['), true);
});
