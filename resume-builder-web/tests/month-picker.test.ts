import assert from 'node:assert/strict';
import test from 'node:test';
import { toMonthInputValue, toYearMonth } from '../src/lib/date-utils';

test('month picker stores canonical YYYY-MM values', () => {
  assert.equal(toYearMonth('2021-10'), '2021-10');
  assert.equal(toYearMonth('Oct 2021'), '2021-10');
  assert.equal(toYearMonth('10/2021'), '2021-10');
  assert.equal(toMonthInputValue('Dec 2022'), '2022-12');
});
