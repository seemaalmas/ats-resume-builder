import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowQuotaBanner } from '../app/resume/ResumeEditor';

test('quota banner hidden when payment feature flag is disabled', () => {
  const message = 'Free plan limit reached: create up to 2 resumes.';
  assert.equal(shouldShowQuotaBanner(false, message), false);
});

test('quota banner displays when payment feature flag is enabled and message exists', () => {
  const message = 'Free plan ATS limit reached after 2 scans.';
  assert.equal(shouldShowQuotaBanner(true, message), true);
});

test('quota banner ignores empty messages even if flag enabled', () => {
  assert.equal(shouldShowQuotaBanner(true, '    '), false);
});
