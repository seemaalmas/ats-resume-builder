import assert from 'node:assert/strict';
import test from 'node:test';
import { templates, type TemplateVariant } from '@/src/components/TemplatePreview';

const SUPPORTED_VARIANTS: TemplateVariant[] = ['classic', 'modern', 'student', 'senior'];

test('template registry exposes every supported template variant', () => {
  assert(templates.length >= 8, `expected at least 8 templates, got ${templates.length}`);
  const seen = new Set<string>();
  for (const template of templates) {
    assert.ok(template.id, 'template id should not be empty');
    assert(!seen.has(template.id), `duplicate template id ${template.id}`);
    seen.add(template.id);
    assert.ok(
      SUPPORTED_VARIANTS.includes(template.variant),
      `template ${template.id} references unsupported variant ${template.variant}`,
    );
  }
});
