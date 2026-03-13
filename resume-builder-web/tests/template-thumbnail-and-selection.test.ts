import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { computePreviewScale, TEMPLATE_PAGE_WIDTH, TEMPLATE_PAGE_HEIGHT } from '../src/components/TemplatePreviewFrame';

const renderPath = path.join(__dirname, '..', 'src', 'components', 'ResumeTemplateRender.tsx');
const catalogGridPath = path.join(__dirname, '..', 'src', 'components', 'templates', 'TemplateCatalogGrid.tsx');
const templateSelectionPath = path.join(__dirname, '..', 'app', 'resume', 'template', 'TemplateSelectionView.tsx');
const globalsPath = path.join(__dirname, '..', 'app', 'globals.css');

// ── Issue 1: Template thumbnails must show actual readable resume content ──

test('thumbnail mode renders TemplatePreview directly without TemplatePreviewFrame (no scaling)', () => {
  const src = readFileSync(renderPath, 'utf-8');
  // The thumbnail branch should render TemplatePreview but NOT TemplatePreviewFrame
  // We check that there's a thumbnail code path that returns <TemplatePreview without <TemplatePreviewFrame
  assert(
    src.includes("if (mode === 'thumbnail')"),
    'Should have a dedicated thumbnail branch',
  );
  // Count occurrences: TemplatePreview should appear more times than TemplatePreviewFrame
  // because the thumbnail branch uses TemplatePreview directly (no frame)
  const previewCount = (src.match(/<TemplatePreview/g) || []).length;
  const frameCount = (src.match(/<TemplatePreviewFrame/g) || []).length;
  assert(
    previewCount > frameCount,
    `Thumbnail renders TemplatePreview directly (${previewCount} previews vs ${frameCount} frames)`,
  );
});

test('thumbnail renders the actual template component (same as live preview)', () => {
  const src = readFileSync(renderPath, 'utf-8');
  // Both thumbnail and full modes should use TemplatePreview
  const templatePreviewCount = (src.match(/<TemplatePreview/g) || []).length;
  assert(
    templatePreviewCount >= 2,
    `Should render TemplatePreview in both modes, found ${templatePreviewCount} usages`,
  );
});

test('thumbnail CSS allows template to render at container natural width', () => {
  const css = readFileSync(globalsPath, 'utf-8');
  // .resume-template-render--thumbnail should not force height: 100%
  // which would compress content — height should be auto
  const thumbnailRule = css.split('.resume-template-render--thumbnail')[1]?.split('}')[0] || '';
  assert(
    thumbnailRule.includes('height: auto'),
    'Thumbnail renderer should use height:auto so template flows naturally',
  );
  assert(
    thumbnailRule.includes('overflow: hidden'),
    'Thumbnail renderer should clip overflow to show only top portion',
  );
});

test('thumbnail container clips content with aspect-ratio and overflow:hidden', () => {
  const css = readFileSync(globalsPath, 'utf-8');
  // .template-card__thumbnail should have overflow:hidden
  const thumbRule = css.split('.template-card__thumbnail')[1]?.split('}')[0] || '';
  assert(
    thumbRule.includes('overflow: hidden'),
    'Card thumbnail container should clip overflowing content',
  );
  // .template-card__preview should have aspect-ratio for consistent card sizing
  const previewRule = css.split('.template-card__preview')[1]?.split('}')[0] || '';
  assert(
    previewRule.includes('aspect-ratio'),
    'Card preview container should maintain aspect-ratio for consistent height',
  );
});

test('thumbnail removes ats-template border to avoid double border inside card', () => {
  const css = readFileSync(globalsPath, 'utf-8');
  assert(
    css.includes('.template-card__thumbnail .resume-template-render--thumbnail .ats-template'),
    'CSS should target ats-template inside thumbnail to remove its border',
  );
});

test('full mode still uses TemplatePreviewFrame for proper page scaling', () => {
  const src = readFileSync(renderPath, 'utf-8');
  assert(
    src.includes('<TemplatePreviewFrame'),
    'Full mode should use TemplatePreviewFrame for page-level scaling',
  );
  assert(
    src.includes('mode="full"'),
    'Full mode should pass mode="full" to TemplatePreviewFrame',
  );
});

// ── Issue 2: Clicking template card navigates to template selection ──

test('entire template card article is clickable (not just the preview area)', () => {
  const src = readFileSync(catalogGridPath, 'utf-8');
  assert(
    src.includes('<article') && src.includes('onClick'),
    'Template card article should have onClick for full-card clickability',
  );
  assert(
    src.includes('role="button"'),
    'Template card should have role="button" for accessibility',
  );
});

test('inner preview area stops propagation to prevent double navigation', () => {
  const src = readFileSync(catalogGridPath, 'utf-8');
  assert(
    src.includes('event.stopPropagation()'),
    'Inner preview area should stopPropagation to prevent bubbling to article onClick',
  );
});

// ── Issue 3: Template URL param must match displayed template ──

test('template selection view uses refs to prevent stale closure in async fetch', () => {
  const src = readFileSync(templateSelectionPath, 'utf-8');
  assert(
    src.includes('urlTemplateRef'),
    'Should use a ref to track the latest URL template to avoid stale closures in async callbacks',
  );
});

test('URL template param takes priority over saved resume templateId', () => {
  const src = readFileSync(templateSelectionPath, 'utf-8');
  assert(
    src.includes('const urlTemplate = hasUrlTemplateRef.current ? urlTemplateRef.current : null'),
    'Fetch callback should extract URL template from ref',
  );
  assert(
    src.includes('const initialTemplate = urlTemplate || savedTemplate'),
    'URL template should take priority over saved template',
  );
});

test('URL sync effect runs to override any race conditions after fetch', () => {
  const src = readFileSync(templateSelectionPath, 'utf-8');
  assert(
    src.includes('setSelectedTemplate(requestedTemplate)'),
    'URL sync effect should explicitly set selectedTemplate from URL param',
  );
});

// ── Scale computation tests (for full preview) ──

test('computePreviewScale returns correct scale for full preview container', () => {
  const scale = computePreviewScale(600, 850);
  const expected = Math.min(600 / TEMPLATE_PAGE_WIDTH, 850 / TEMPLATE_PAGE_HEIGHT);
  assert.strictEqual(scale, expected);
  assert.ok(scale > 0 && scale <= 1, `Scale should be between 0 and 1, got ${scale}`);
});

test('computePreviewScale never exceeds 1 even when container is large', () => {
  assert.strictEqual(computePreviewScale(2000, 3200), 1);
});

test('computePreviewScale handles zero dimensions gracefully', () => {
  assert.strictEqual(computePreviewScale(0, 0), 1);
  assert.strictEqual(computePreviewScale(0, 500), 1);
  assert.strictEqual(computePreviewScale(500, 0), 1);
});
