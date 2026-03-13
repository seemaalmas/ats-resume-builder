import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { computePreviewScale, TEMPLATE_PAGE_WIDTH, TEMPLATE_PAGE_HEIGHT } from '../src/components/TemplatePreviewFrame';

const previewFramePath = path.join(__dirname, '..', 'src', 'components', 'TemplatePreviewFrame.tsx');
const renderPath = path.join(__dirname, '..', 'src', 'components', 'ResumeTemplateRender.tsx');
const catalogGridPath = path.join(__dirname, '..', 'src', 'components', 'templates', 'TemplateCatalogGrid.tsx');
const templateSelectionPath = path.join(__dirname, '..', 'app', 'resume', 'template', 'TemplateSelectionView.tsx');
const globalsPath = path.join(__dirname, '..', 'app', 'globals.css');

// ── Issue 1: Template thumbnails must show actual resume structure ──

test('thumbnail mode uses CSS zoom instead of transform:scale for crisp text rendering', () => {
  const src = readFileSync(previewFramePath, 'utf-8');
  assert(
    src.includes("zoom: scale"),
    'Thumbnail page div should use CSS zoom property for proper text rasterization',
  );
  assert(
    src.includes("mode === 'thumbnail'"),
    'TemplatePreviewFrame should branch on thumbnail mode',
  );
});

test('thumbnail page div does not use transform:scale which rasterizes text as blurry blocks', () => {
  const src = readFileSync(previewFramePath, 'utf-8');
  // Extract the thumbnail rendering branch
  const thumbnailBranch = src.split("mode === 'thumbnail'")[1]?.split('return (')[1]?.split('</div>')[0] || '';
  assert(
    !thumbnailBranch.includes('transform:') && !thumbnailBranch.includes("transform`"),
    'Thumbnail branch should not use CSS transform (zoom renders text crisply at target size)',
  );
});

test('thumbnail page CSS disables GPU compositing for proper font hinting', () => {
  const css = readFileSync(globalsPath, 'utf-8');
  assert(
    css.includes('.template-preview-frame__page--thumbnail'),
    'CSS should have a dedicated thumbnail page class',
  );
  assert(
    css.includes('will-change: auto'),
    'Thumbnail page should disable will-change to prevent GPU text rasterization',
  );
  assert(
    css.includes('text-rendering: optimizeLegibility'),
    'Thumbnail page should use optimizeLegibility for crisp small text',
  );
  assert(
    css.includes('-webkit-font-smoothing: antialiased'),
    'Thumbnail page should enable antialiased font smoothing',
  );
});

test('thumbnail container clips overflow from zoomed page content', () => {
  const css = readFileSync(globalsPath, 'utf-8');
  assert(
    css.includes('.template-preview-frame__container--thumbnail'),
    'CSS should have a dedicated thumbnail container class',
  );
  // The container must use overflow:hidden so the zoomed page is clipped to fit
  const containerRule = css.split('.template-preview-frame__container--thumbnail')[1]?.split('}')[0] || '';
  assert(
    containerRule.includes('overflow: hidden'),
    'Thumbnail container should use overflow:hidden to clip zoomed content',
  );
});

test('thumbnail page uses position:static (not absolute) since zoom handles sizing', () => {
  const css = readFileSync(globalsPath, 'utf-8');
  const thumbnailRule = css.split('.template-preview-frame__page--thumbnail')[1]?.split('}')[0] || '';
  assert(
    thumbnailRule.includes('position: static'),
    'Thumbnail page should use position:static since zoom changes layout size',
  );
});

test('thumbnail initial scale starts small to prevent flash of clipped content at scale=1', () => {
  const src = readFileSync(previewFramePath, 'utf-8');
  assert(
    src.includes("mode === 'thumbnail' ? 0.5 : 1"),
    'Initial scale for thumbnail mode should be 0.5 (not 1) to prevent initial clipping',
  );
});

test('ResumeTemplateRender uses full page dimensions for thumbnails (matching live preview)', () => {
  const src = readFileSync(renderPath, 'utf-8');
  // Should NOT have separate thumbnail dimensions
  assert(
    !src.includes('THUMBNAIL_PAGE_WIDTH'),
    'Should not define separate thumbnail dimensions — use full page size for correct proportions',
  );
  assert(
    src.includes('TEMPLATE_PAGE_WIDTH'),
    'Should use the standard page width for all modes',
  );
});

// ── Issue 2: Clicking template card navigates to template selection ──

test('entire template card article is clickable (not just the preview area)', () => {
  const src = readFileSync(catalogGridPath, 'utf-8');
  // The article element should have an onClick handler
  assert(
    src.includes('<article') && src.includes('onClick'),
    'Template card article should have onClick for full-card clickability',
  );
  // The article should have role="button" for accessibility
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
  assert(
    src.includes('hasUrlTemplateRef'),
    'Should use a ref to track whether a URL template exists',
  );
});

test('fetch callback reads URL template from ref (not stale closure)', () => {
  const src = readFileSync(templateSelectionPath, 'utf-8');
  assert(
    src.includes('urlTemplateRef.current'),
    'Fetch .then() should read URL template from ref to get the latest value',
  );
  assert(
    src.includes('hasUrlTemplateRef.current'),
    'Fetch .then() should check URL template presence from ref',
  );
});

test('URL sync effect still runs to override any race conditions after fetch', () => {
  const src = readFileSync(templateSelectionPath, 'utf-8');
  // The URL sync effect should set selectedTemplate to requestedTemplate
  assert(
    src.includes('setSelectedTemplate(requestedTemplate)'),
    'URL sync effect should explicitly set selectedTemplate from URL param',
  );
});

test('URL template param takes priority over saved resume templateId', () => {
  const src = readFileSync(templateSelectionPath, 'utf-8');
  // The fetch callback should use URL template (via ref) when available
  assert(
    src.includes('const urlTemplate = hasUrlTemplateRef.current ? urlTemplateRef.current : null'),
    'Fetch callback should extract URL template from ref',
  );
  assert(
    src.includes('const initialTemplate = urlTemplate || savedTemplate'),
    'URL template should take priority over saved template',
  );
});

// ── Scale computation tests ──

test('computePreviewScale returns correct scale for typical thumbnail container', () => {
  // Typical thumbnail container: ~370×523 (card in sidebar)
  const scale = computePreviewScale(370, 523);
  const expected = Math.min(370 / TEMPLATE_PAGE_WIDTH, 523 / TEMPLATE_PAGE_HEIGHT);
  assert.strictEqual(scale, expected);
  assert.ok(scale > 0.4 && scale < 0.6, `Thumbnail scale should be ~0.47, got ${scale}`);
});

test('computePreviewScale returns correct scale for gallery card', () => {
  // Gallery card: ~380×538
  const scale = computePreviewScale(380, 538);
  assert.ok(scale > 0.4 && scale < 0.6, `Gallery thumbnail scale should be ~0.48, got ${scale}`);
});

test('computePreviewScale handles zero dimensions gracefully', () => {
  assert.strictEqual(computePreviewScale(0, 0), 1);
  assert.strictEqual(computePreviewScale(0, 500), 1);
  assert.strictEqual(computePreviewScale(500, 0), 1);
});
