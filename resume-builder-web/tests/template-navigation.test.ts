import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildTemplateSelectionRoute } from '../src/lib/resume-flow';

const appDir = path.join(__dirname, '..', 'app', 'resume');
const editorPath = path.join(appDir, 'ResumeEditor.tsx');
const templatesPath = path.join(appDir, 'template', 'TemplateSelectionView.tsx');
const dashboardPath = path.join(__dirname, '..', 'app', 'dashboard', 'page.tsx');

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
  const { templates } = require('../src/components/TemplatePreview');
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  assert(dashboardContent.includes('template-grid'), 'Dashboard should render the template-grid class');
  assert(dashboardContent.includes('template-card'), 'Dashboard should use template-card class for cards');
  assert(dashboardContent.includes('templates.map'), 'Dashboard should iterate over all templates from registry');
  assert(dashboardContent.includes('data-testid="dashboard-template-grid"'), 'Dashboard grid should have testid');
  assert(dashboardContent.includes('TemplatePreview'), 'Dashboard should use the proper TemplatePreview component');
  assert(dashboardContent.includes('compact'), 'Dashboard template cards should use compact mode');
  assert(templates.length >= 8, `Expected at least 8 templates in registry, got ${templates.length}`);
});

test('dashboard template click navigates to template selection page', () => {
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  assert(dashboardContent.includes('handleTemplateClick'), 'Dashboard should define handleTemplateClick handler');
  assert(dashboardContent.includes('buildTemplateSelectionRoute'), 'Dashboard should use buildTemplateSelectionRoute for navigation');
  assert(dashboardContent.includes('router.push'), 'Dashboard should use router.push for navigation');
});

test('dashboard imports TemplatePreview from shared component (not local)', () => {
  const dashboardContent = readFileSync(dashboardPath, 'utf-8');
  assert(
    dashboardContent.includes("from '@/src/components/TemplatePreview'"),
    'Dashboard should import TemplatePreview from shared component',
  );
  assert(
    !dashboardContent.includes('function TemplatePreview('),
    'Dashboard should NOT define a local TemplatePreview function',
  );
});
