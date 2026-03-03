import assert from 'node:assert/strict';
import test from 'node:test';
import { computePreviewScale, TEMPLATE_PAGE_HEIGHT, TEMPLATE_PAGE_WIDTH } from '@/src/components/TemplatePreviewFrame';

test('computePreviewScale clamps to page ratio', () => {
  const width = 400;
  const height = 600;
  const expected = Math.min(width / TEMPLATE_PAGE_WIDTH, height / TEMPLATE_PAGE_HEIGHT, 1);
  assert.strictEqual(computePreviewScale(width, height), expected);
});

test('computePreviewScale never exceeds 1 even when container is large', () => {
  const scale = computePreviewScale(2000, 3200);
  assert.strictEqual(scale, 1);
});
