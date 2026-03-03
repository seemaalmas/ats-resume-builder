import assert from 'node:assert/strict';
import test from 'node:test';
import { templateList, templateRegistry, type TemplateId } from '@/shared/templateRegistry';

const SUPPORTED_IDS: TemplateId[] = ['classic', 'modern', 'executive', 'technical', 'graduate'];

test('template registry exposes the five supported ATS templates', () => {
  assert.equal(templateList.length, 5);
  const seen = new Set<string>();
  for (const template of templateList) {
    assert.ok(template.id, 'template id should not be empty');
    assert(!seen.has(template.id), `duplicate template id ${template.id}`);
    seen.add(template.id);
    assert.ok(SUPPORTED_IDS.includes(template.id as TemplateId), `unsupported template id ${template.id}`);
    assert.equal(typeof template.component, 'function');
  }
});

test('template registry object keys match template ids', () => {
  for (const id of SUPPORTED_IDS) {
    assert.ok(templateRegistry[id], `missing registry entry for ${id}`);
    assert.equal(templateRegistry[id].id, id);
  }
});

