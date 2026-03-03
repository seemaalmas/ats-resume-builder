import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildTemplateSelectionRoute } from '../src/lib/resume-flow';

const appDir = path.join(__dirname, '..', 'app', 'resume');
const editorPath = path.join(appDir, 'ResumeEditor.tsx');
const reviewPagePath = path.join(appDir, 'review', 'page.tsx');
const templatesPath = path.join(appDir, 'template', 'TemplateSelectionView.tsx');
const dashboardPath = path.join(__dirname, '..', 'app', 'dashboard', 'page.tsx');
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

test('/resume/template renders gallery and preview in source', () => {
  const templatesContent = readFileSync(templatesPath, 'utf-8');
  assert(templatesContent.includes('template-grid'), 'Templates page should still render the gallery grid');
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
  assert(dashboardContent.includes('template-grid'), 'Dashboard should render the template-grid class');
  assert(dashboardContent.includes('template-card'), 'Dashboard should use template-card class for cards');
  assert(dashboardContent.includes('templateList.map'), 'Dashboard should iterate over all templates from registry');
  assert(dashboardContent.includes('data-testid="dashboard-template-grid"'), 'Dashboard grid should have testid');
  assert(dashboardContent.includes('templateRegistry'), 'Dashboard should use shared template registry components');
  assert(dashboardContent.includes('<TemplatePreviewFrame>'), 'Dashboard template cards should use TemplatePreviewFrame');
  assert.equal(templateList.length, 5, `Expected exactly 5 templates in registry, got ${templateList.length}`);
});

test('dashboard template click navigates to template selection page', () => {
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  assert(dashboardContent.includes('handleTemplateClick'), 'Dashboard should define handleTemplateClick handler');
  assert(dashboardContent.includes('buildTemplateSelectionRoute'), 'Dashboard should use buildTemplateSelectionRoute for navigation');
  assert(dashboardContent.includes('router.push'), 'Dashboard should use router.push for navigation');
});

test('dashboard template cards reuse template selection preview structure', () => {
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  assert(
    !dashboardContent.includes('TemplateThumbnail'),
    'Dashboard should not use a dashboard-specific thumbnail component',
  );
  assert(
    !dashboardContent.includes('template-card__preview--dashboard'),
    'Dashboard should not use dashboard-specific preview wrappers',
  );
  assert(
    !dashboardContent.includes('/templates/preview?'),
    'Dashboard cards should navigate to /resume/template flow and not custom preview route',
  );
});

test('dashboard imports shared template registry (not local template component)', () => {
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  assert(
    dashboardContent.includes("from '@/shared/templateRegistry'"),
    'Dashboard should import templateRegistry from shared module',
  );
  assert(
    !dashboardContent.includes('function TemplatePreview('),
    'Dashboard should NOT define a local template preview function',
  );
});

test('/resume/review switches to lightweight embed preview when embed=1', () => {
  const reviewPageContent = readFileSync(reviewPagePath, 'utf-8');
  assert(
    reviewPageContent.includes("readSearchParam(searchParams?.embed) === '1'"),
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

test('dashboard and template selection reuse TemplatePreviewFrame for full-page scaled previews', () => {
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  const templatesContent = readFileSync(templatesPath, 'utf-8');
  assert(
    dashboardContent.includes("from '@/src/components/TemplatePreviewFrame'"),
    'Dashboard should import shared TemplatePreviewFrame',
  );
  assert(
    dashboardContent.includes('<TemplatePreviewFrame>'),
    'Dashboard should wrap template previews with TemplatePreviewFrame',
  );
  assert(
    templatesContent.includes("from '@/src/components/TemplatePreviewFrame'"),
    'Template selection view should import shared TemplatePreviewFrame',
  );
  assert(
    templatesContent.includes('<TemplatePreviewFrame>'),
    'Template selection view should wrap gallery/live previews with TemplatePreviewFrame',
  );
  assert(
    !templatesContent.includes('style={{ zoom: previewZoom }}'),
    'Template selection view should avoid CSS zoom-based preview scaling',
  );
});

test('/resume route keeps base grid while /resume/review keeps review-grid', () => {
  const editorContent = readFileSync(editorPath, 'utf-8');
  assert(
    editorContent.includes("className={isReviewAtsPage ? 'grid review-grid' : 'grid'}"),
    'ResumeEditor should apply review-grid only on /resume/review',
  );
});

test('template preview frame CSS uses exact page aspect ratio to avoid clipping', () => {
  const globals = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf-8');
  assert(
    globals.includes('aspect-ratio: 794 / 1123;'),
    'Template preview frame should use the exact rendered page ratio',
  );
  assert(
    !globals.includes('.template-card__preview--dashboard') && !globals.includes('.dashboard-template-thumbnail'),
    'Dashboard-specific preview overrides should be removed to match template page rendering',
  );
});
