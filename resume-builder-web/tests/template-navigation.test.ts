import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildTemplateSelectionRoute } from '../src/lib/resume-flow';

const appDir = path.join(__dirname, '..', 'app', 'resume');
const editorPath = path.join(appDir, 'ResumeEditor.tsx');
const reviewPagePath = path.join(appDir, 'review', 'page.tsx');
const templatesPath = path.join(appDir, 'template', 'TemplateSelectionView.tsx');
const dashboardPath = path.join(__dirname, '..', 'app', 'dashboard', 'DashboardPageView.tsx');
const templatePreviewPagePath = path.join(__dirname, '..', 'app', 'templates', 'preview', 'TemplatePreviewPageClient.tsx');

test('resume review editor no longer contains template gallery markup and shows template prompt text', () => {
  const editorContent = readFileSync(editorPath, 'utf-8');
  assert(!editorContent.includes('template-grid'), 'Editor should not render the template gallery grid');
  assert(editorContent.includes('Do you want to choose template now?'), 'Editor should render the template prompt copy');
  assert(editorContent.includes('grid review-grid'), 'Editor main should use review-grid layout class');
  assert(editorContent.includes('Sections'), 'Editor should render the section navigator heading');
});

test('template navigation button routes to new templates page', () => {
  const route = buildTemplateSelectionRoute('resume-123');
  assert.equal(route, '/resume/template?resumeId=resume-123');
});

test('template navigation can include a selected template id', () => {
  const route = buildTemplateSelectionRoute('resume-123', 'modern');
  assert.equal(route, '/resume/template?resumeId=resume-123&template=modern');
});

test('/resume/template renders gallery and preview in source', () => {
  const templatesContent = readFileSync(templatesPath, 'utf-8');
  assert(templatesContent.includes('TemplateCatalogGrid'), 'Templates page should render shared template catalog grid');
  assert(templatesContent.includes('template-live'), 'Templates page should still render the live preview panel');
  assert(templatesContent.includes('grid template-grid-layout'), 'Templates main should use template-grid-layout class');
});

test('globals container now uses 90vw width without fixed max-width', () => {
  const globals = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf-8');
  assert(globals.includes('width: 90vw'), 'Main shell should define width 90vw');
  assert(!globals.includes('max-width: 1100px'), 'Main shell should not enforce max-width 1100px');
});

test('dashboard renders all templates from registry using proper template cards', () => {
  const { templateList } = require('../shared/templateRegistry');
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  assert(dashboardContent.includes('dashboard-template-grid'), 'Dashboard should render the template grid test id');
  assert(dashboardContent.includes('TemplateCatalogGrid'), 'Dashboard should use shared template catalog grid component');
  assert(dashboardContent.includes('DASHBOARD_TEMPLATE_OPTIONS'), 'Dashboard should derive options from shared catalog');
  assert(dashboardContent.includes('dataTestId="dashboard-template-grid"'), 'Dashboard should pass dashboard template grid test id');
  assert(dashboardContent.includes("from 'resume-builder-shared'"), 'Dashboard should import shared catalog metadata');
  assert.equal(templateList.length, 6, `Expected exactly 6 templates in registry, got ${templateList.length}`);
});

test('dashboard template click navigates to template selection page', () => {
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  assert(dashboardContent.includes('handleTemplateSelect'), 'Dashboard should define template-select handler');
  assert(dashboardContent.includes('buildTemplateSelectionRoute'), 'Dashboard should use buildTemplateSelectionRoute for navigation');
  assert(
    dashboardContent.includes('buildTemplateSelectionRoute(activeResume.id, templateId)'),
    'Dashboard should forward both resumeId and templateId to preview flow',
  );
  assert(dashboardContent.includes('router.push'), 'Dashboard should use router.push for navigation');
});

test('dashboard no longer auto-selects the newest saved resume on load', () => {
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  assert(
    !dashboardContent.includes('readActiveResumeSelection'),
    'Dashboard should not restore a stale selected resume from session storage',
  );
  assert(
    !dashboardContent.includes('setSelectedResumeId(sortedResumes[0].id)'),
    'Dashboard should not auto-select the first saved resume',
  );
});

test('dashboard template cards reuse template selection preview structure', () => {
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  assert(
    dashboardContent.includes('<TemplateCatalogGrid'),
    'Dashboard should reuse the same template card component as template selection',
  );
  assert(
    dashboardContent.includes('layoutVariant="gallery"'),
    'Dashboard should opt into the compact gallery grid variant',
  );
});

test('template card grid mounts the shared resume renderer in thumbnail mode', () => {
  const gridContent = readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'templates', 'TemplateCatalogGrid.tsx'),
    'utf-8',
  );
  assert(
    gridContent.includes('data-preview-kind="thumbnail"'),
    'Template card grid should render thumbnail-only previews',
  );
  assert(
    gridContent.includes('ResumeTemplateRender'),
    'Template card grid should reuse the shared resume renderer',
  );
  assert(
    gridContent.includes('mode="thumbnail"'),
    'Template card grid should mount the shared renderer in thumbnail mode',
  );
  assert(
    gridContent.includes('previewLoading'),
    'Template card grid should only show fallback card content during loading',
  );
});

test('dashboard imports shared template registry (not local template component)', () => {
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  assert(
    dashboardContent.includes("from 'resume-builder-shared'"),
    'Dashboard should import template catalog from shared package',
  );
  assert(
    dashboardContent.includes("from '@/shared/templateRegistry'"),
    'Dashboard should map shared catalog ids through template registry',
  );
});

test('/resume/review switches to lightweight embed preview when embed=1', () => {
  const reviewPageContent = readFileSync(reviewPagePath, 'utf-8');
  assert(
    reviewPageContent.includes("readSearchParam(params.embed) === '1'"),
    'Review page should detect embed query mode',
  );
  assert(
    reviewPageContent.includes('ResumeReviewEmbedPreview'),
    'Review page should render embed preview component when embed mode is requested',
  );
});

test('/templates/preview page renders resume preview actions and edit navigation', () => {
  const previewPageContent = readFileSync(templatePreviewPagePath, 'utf-8');
  assert(
    previewPageContent.includes('<ResumeTemplateRender'),
    'Template preview page should render resume preview using shared ResumeTemplateRender',
  );
  assert(
    previewPageContent.includes('mode="full"'),
    'Template preview page should use full rendering mode',
  );
  assert(
    previewPageContent.includes('Apply Template'),
    'Template preview page should expose Apply Template action',
  );
  assert(
    previewPageContent.includes('Edit Resume'),
    'Template preview page should expose Edit Resume action',
  );
});

test('/templates/preview no longer falls back to the first saved resume', () => {
  const previewPageContent = readFileSync(templatePreviewPagePath, 'utf-8');
  assert(
    previewPageContent.includes('resolveCurrentSessionResumeId'),
    'Template preview page should resolve resume ids through the shared explicit-selection helper',
  );
  assert(
    !previewPageContent.includes('list[0]?.id'),
    'Template preview page should not auto-load the first saved resume',
  );
});

test('/resume/template keeps the only live full preview pane', () => {
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  const templatesContent = readFileSync(templatesPath, 'utf-8');
  assert(
    dashboardContent.includes("from '@/src/components/templates/TemplateCatalogGrid'"),
    'Dashboard should import shared TemplateCatalogGrid',
  );
  assert(
    dashboardContent.includes('<TemplateCatalogGrid'),
    'Dashboard should render shared TemplateCatalogGrid',
  );
  assert(
    templatesContent.includes("from '@/src/components/templates/TemplateCatalogGrid'"),
    'Template selection view should import shared TemplateCatalogGrid',
  );
  assert(
    templatesContent.includes('<TemplateCatalogGrid'),
    'Template selection view should render shared TemplateCatalogGrid for gallery cards',
  );
  assert(
    templatesContent.includes('TemplatePreviewFrame'),
    'Template selection view should keep the dedicated live preview frame',
  );
  assert(
    templatesContent.includes('template-selection-preview'),
    'Template selection view should expose the dedicated preview pane test id',
  );
});

test('/resume route keeps base grid while /resume/review keeps review-grid', () => {
  const editorContent = readFileSync(editorPath, 'utf-8');
  assert(
    editorContent.includes("className={isReviewAtsPage ? 'grid review-grid' : 'grid'}"),
    'ResumeEditor should apply review-grid only on /resume/review',
  );
});

test('/resume/review no longer hydrates the latest saved resume without explicit selection', () => {
  const editorContent = readFileSync(editorPath, 'utf-8');
  assert(
    !editorContent.includes('Loaded your latest resume for Review & ATS.'),
    'ResumeEditor should not auto-load the latest saved resume for review',
  );
  assert(
    !editorContent.includes('api.listResumes()'),
    'ResumeEditor should not fetch the latest saved resume when review has no explicit selection',
  );
});

test('template preview frame CSS uses exact page aspect ratio to avoid clipping', () => {
  const globals = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf-8');
  assert(
    globals.includes('aspect-ratio: 794 / 1123;'),
    'Template preview frame should use the exact rendered page ratio',
  );
  assert(
    globals.includes('.template-grid--gallery'),
    'Dashboard gallery should have a dedicated compact grid variant',
  );
  assert(
    globals.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'),
    'Desktop dashboard gallery should use two columns',
  );
  assert(
    globals.includes('@media (max-width: 900px)') && globals.includes('.template-grid--gallery'),
    'Dashboard gallery should collapse to one column below the tablet breakpoint',
  );
});
