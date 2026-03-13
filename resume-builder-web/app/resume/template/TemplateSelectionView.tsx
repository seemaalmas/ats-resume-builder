'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TEMPLATE_CATALOG } from 'resume-builder-shared';
import { api, type Resume } from '@/src/lib/api';
import TemplateCatalogGrid from '@/src/components/templates/TemplateCatalogGrid';
import {
  buildResumePreview,
  persistActiveResumeSelection,
  resolveCurrentSessionResumeId,
  resumeFromApi,
} from '@/src/lib/resume-flow';
import { recommendTemplates } from '@/src/lib/template-recommendation';
import { useResumeStore, type ResumeDraft } from '@/src/lib/resume-store';
import { TemplatePreviewFrame } from '@/src/components/TemplatePreviewFrame';
import { resolveTemplateId, templateRegistry, type TemplateId } from '@/shared/templateRegistry';

const TEMPLATE_OPTIONS = TEMPLATE_CATALOG.map((template) => templateRegistry[template.id]);

type TemplateSelectionApiClient = Pick<typeof api, 'downloadPdf' | 'getResume' | 'ingestResume' | 'updateResume'>;

type RouterLike = {
  push: (href: string) => Promise<boolean> | void;
  replace?: (href: string) => Promise<boolean> | void;
};

type SearchParamsLike = {
  get: (key: string) => string | null;
};

const fallbackRouter: RouterLike = {
  push: async () => true,
  replace: async () => true,
};

export type TemplateSelectionViewProps = {
  apiClient?: TemplateSelectionApiClient;
  routerOverride?: RouterLike;
  searchParamsOverride?: SearchParamsLike;
};

function mergeTemplateSaveResult(current: Resume | null, updated: Resume, template: TemplateId): Resume {
  if (!current || current.id !== updated.id) {
    return {
      ...updated,
      templateId: template,
    };
  }
  return {
    ...current,
    id: updated.id || current.id,
    userId: updated.userId || current.userId,
    createdAt: updated.createdAt || current.createdAt,
    updatedAt: updated.updatedAt || current.updatedAt,
    templateId: template,
  };
}

export default function TemplateSelectionView({
  apiClient = api,
  routerOverride,
  searchParamsOverride,
}: TemplateSelectionViewProps = {}) {
  const nextRouter = process.env.NEXT_TEST_MOCK_ROUTER === '1' ? null : useRouter();
  const nextSearchParams = process.env.NEXT_TEST_MOCK_ROUTER === '1' ? null : useSearchParams();
  const router = routerOverride ?? nextRouter ?? fallbackRouter;
  const searchParams = searchParamsOverride ?? nextSearchParams ?? new URLSearchParams();
  const requestedResumeId = String(searchParams.get('resumeId') || '').trim();
  const resumeId = resolveCurrentSessionResumeId(requestedResumeId);
  const templateQuery = String(searchParams.get('template') || '').trim();
  const hasTemplateQuery = Boolean(templateQuery);
  const requestedTemplate = resolveTemplateId(templateQuery, 'classic');
  const [resumeData, setResumeData] = useState<Resume | null>(null);
  const [resumeDraft, setResumeDraft] = useState<ResumeDraft | null>(null);
  const [loading, setLoading] = useState(Boolean(resumeId));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [toast, setToast] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>(requestedTemplate);
  const [pendingUploadFileName, setPendingUploadFileName] = useState('');
  const pendingTemplateSaveRef = useRef<Promise<void> | null>(null);
  const templateSaveRunRef = useRef(0);
  const activeTemplateMeta = useMemo(() => TEMPLATE_OPTIONS.find((template) => template.id === selectedTemplate), [selectedTemplate]);
  const ActiveTemplateComponent = templateRegistry[selectedTemplate].component;
  const previewResume = useMemo(() => (resumeDraft ? buildResumePreview(resumeDraft) : null), [resumeDraft]);
  const recommendation = useMemo(() => (resumeDraft ? recommendTemplates(resumeDraft) : null), [resumeDraft]);
  const setResumeStore = useResumeStore((state) => state.setResume);

  const applySavedTemplate = (updated: Resume, template: TemplateId, toastText = '') => {
    const nextResume = mergeTemplateSaveResult(resumeData, updated, template);
    persistActiveResumeSelection(nextResume.id || resumeId);
    setResumeData(nextResume);
    const draft = { ...resumeFromApi(nextResume), templateId: template };
    setResumeDraft(draft);
    setResumeStore(() => draft);
    setSelectedTemplate(template);
    if (toastText) setToast(toastText);
  };

  useEffect(() => {
    if (resumeId) {
      persistActiveResumeSelection(resumeId);
    }
  }, [resumeId]);

  // Track which template the URL requested so the fetch callback can
  // use the latest value even when the closure was captured earlier.
  const urlTemplateRef = useRef(requestedTemplate);
  const hasUrlTemplateRef = useRef(hasTemplateQuery);
  urlTemplateRef.current = requestedTemplate;
  hasUrlTemplateRef.current = hasTemplateQuery;

  useEffect(() => {
    if (!resumeId) {
      setError('Select a saved resume or upload a new one to preview templates.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    apiClient.getResume(resumeId)
      .then((data) => {
        if (cancelled) return;
        // Always read the latest URL param via ref to avoid stale closures
        const urlTemplate = hasUrlTemplateRef.current ? urlTemplateRef.current : null;
        const savedTemplate = resolveTemplateId(data.templateId || '', 'classic');
        const initialTemplate = urlTemplate || savedTemplate;
        setResumeData(data);
        const draft = { ...resumeFromApi(data), templateId: initialTemplate };
        setResumeDraft(draft);
        setResumeStore(() => draft);
        setSelectedTemplate(initialTemplate);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load resume.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, resumeId, setResumeStore]);

  // Ensure URL template param always overrides any other state (runs after fetch completes too)
  useEffect(() => {
    if (!hasTemplateQuery) return;
    setSelectedTemplate(requestedTemplate);
    setResumeDraft((prev) => (prev ? { ...prev, templateId: requestedTemplate } : prev));
    setResumeStore((prev) => ({ ...prev, templateId: requestedTemplate }));
  }, [hasTemplateQuery, requestedTemplate, setResumeStore]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const persistTemplate = (template: TemplateId, toastText = '') => {
    if (!resumeId) return Promise.resolve();
    setSaving(true);
    setError('');
    const runId = ++templateSaveRunRef.current;
    const savePromise = apiClient.updateResume(resumeId, { templateId: template })
      .then((updated) => {
        applySavedTemplate(updated, template, toastText);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to save template.');
        throw err;
      })
      .finally(() => {
        if (templateSaveRunRef.current === runId) {
          pendingTemplateSaveRef.current = null;
          setSaving(false);
        }
      });
    pendingTemplateSaveRef.current = savePromise;
    return savePromise;
  };

  const handlePreviewTemplate = (template: TemplateId) => {
    setSelectedTemplate(template);
    setResumeDraft((prev) => (prev ? { ...prev, templateId: template } : prev));
    setResumeStore((prev) => ({ ...prev, templateId: template }));
    setToast('');
  };

  const handleSaveTemplate = async () => {
    try {
      await persistTemplate(selectedTemplate, 'Template applied.');
    } catch {
      // surfaced in state
    }
  };

  const handleUpload = async (file?: File) => {
    if (!file || !resumeId) return;
    setPendingUploadFileName(file.name);
    setUploading(true);
    setError('');
    setToast('');
    try {
      const result = await apiClient.ingestResume(resumeId, file);
      persistActiveResumeSelection(result.resume.id || resumeId);
      const nextDraft = { ...resumeFromApi(result.resume), templateId: selectedTemplate };
      setResumeData(result.resume);
      setResumeDraft(nextDraft);
      setResumeStore(() => nextDraft);
      setToast(`Preview updated from ${file.name}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to replace resume.');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async () => {
    if (!resumeId) return;
    setDownloading(true);
    setError('');
    setToast('');
    try {
      await apiClient.downloadPdf(resumeId, selectedTemplate);
      setToast('PDF download started.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to export PDF.');
    } finally {
      setDownloading(false);
    }
  };

  const previewReady = Boolean(previewResume);
  if (!resumeId && !loading) {
    return (
      <main className="grid">
        <section className="card col-12">
          <h2>Select a resume to preview</h2>
          <p className="small">Select a saved resume or upload a new one to preview templates.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="grid template-grid-layout">
      <section className="card col-7">
        <div>
          <h2>Choose a template</h2>
          <p className="small">Pick the layout you want before exporting.</p>
        </div>
        {loading && <p className="small" style={{ marginTop: 12 }}>Loading resume...</p>}
        {error && (
          <div className="message-banner" style={{ marginTop: 12 }}>
            <p className="small">{error}</p>
          </div>
        )}
        {previewReady || loading ? (
          <div style={{ marginTop: 12 }}>
            <TemplateCatalogGrid
              templates={TEMPLATE_OPTIONS}
              previewResume={previewReady ? previewResume : null}
              selectedTemplate={selectedTemplate}
              recommendation={recommendation}
              onSelectTemplate={handlePreviewTemplate}
              primaryActionLabel="Preview"
              disabled={loading || uploading}
              previewLoading={loading}
              dataTestId="template-selection-grid"
            />
          </div>
        ) : null}
      </section>

      <section className="card col-5 preview-pane" data-testid="template-selection-preview" data-active-template={selectedTemplate}>
        <div className="template-live">
          <div className="template-live__header">
            <div>
              <h4 style={{ margin: 0 }}>Live preview</h4>
              <p className="small">Now viewing {activeTemplateMeta?.name}</p>
              {recommendation && (
                <p className="small template-live__recommendation">
                  Recommended: {TEMPLATE_OPTIONS.find((item) => item.id === recommendation.primaryTemplateId)?.name}.{' '}
                  {recommendation.reasons[0]}
                </p>
              )}
            </div>
            <span className="pill">{resumeData?.templateId === selectedTemplate ? 'Applied' : 'Previewing'}</span>
          </div>
          <div className="template-live__canvas">
            {previewResume ? (
              <TemplatePreviewFrame>
                <div
                  data-template-id={selectedTemplate}
                  data-render-context="preview"
                  data-css-bundle="globals.css#ats-template"
                >
                  <span style={{ display: 'none' }}>{`TEMPLATE_FINGERPRINT:${selectedTemplate}`}</span>
                  <ActiveTemplateComponent resumeData={previewResume} />
                </div>
              </TemplatePreviewFrame>
            ) : (
              <p className="small">Resume preview will appear once data loads.</p>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="btn secondary" style={{ cursor: uploading || !resumeId ? 'not-allowed' : 'pointer' }}>
            {uploading ? `Uploading ${pendingUploadFileName || 'resume'}...` : 'Upload / Replace Resume'}
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              style={{ display: 'none' }}
              disabled={uploading || loading || !resumeId}
              data-testid="template-upload-input"
              onChange={(event) => handleUpload(event.target.files?.[0])}
            />
          </label>
          <button className="btn" onClick={handleSaveTemplate} disabled={!resumeDraft || saving}>
            {saving ? 'Applying...' : 'Use Template'}
          </button>
          <button
            className="btn secondary"
            onClick={() => router.push(resumeId ? `/resume?id=${encodeURIComponent(resumeId)}&template=${encodeURIComponent(selectedTemplate)}` : '/resume')}
            disabled={!resumeId}
          >
            Edit Resume
          </button>
          <button className="btn secondary" onClick={handleDownload} disabled={!resumeId || downloading}>
            {downloading ? 'Preparing PDF...' : 'Download PDF'}
          </button>
          <button className="btn secondary" onClick={() => router.push('/dashboard')}>
            Back to Dashboard
          </button>
          {toast && <span className="small" style={{ marginLeft: 'auto' }}>{toast}</span>}
        </div>
      </section>
    </main>
  );
}
