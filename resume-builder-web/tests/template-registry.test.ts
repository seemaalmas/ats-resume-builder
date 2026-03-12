import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TEMPLATE_ID, TEMPLATE_CATALOG } from 'resume-builder-shared';
import { templateList, templateRegistry, type TemplateId } from '@/shared/templateRegistry';

const SUPPORTED_IDS = TEMPLATE_CATALOG.map((template) => template.id) as TemplateId[];

test('template registry exposes six supported ATS templates', () => {
  assert.equal(templateList.length, TEMPLATE_CATALOG.length);
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

test('template registry preserves shared default template metadata', () => {
  assert.equal(DEFAULT_TEMPLATE_ID, 'classic');
  assert.equal(templateRegistry[DEFAULT_TEMPLATE_ID].isDefault, true);
});
