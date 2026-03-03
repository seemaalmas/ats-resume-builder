'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type Resume } from '@/src/lib/api';
import { buildReviewAtsRoute, buildResumePreview, resumeFromApi } from '@/src/lib/resume-flow';
import { recommendTemplates } from '@/src/lib/template-recommendation';
import { useResumeStore, type ResumeDraft } from '@/src/lib/resume-store';
import { TemplatePreviewFrame } from '@/src/components/TemplatePreviewFrame';
import { resolveTemplateId, templateList, templateRegistry, type TemplateId } from '@/shared/templateRegistry';

export default function TemplateSelectionView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeId = searchParams.get('resumeId') || '';
  const [resumeData, setResumeData] = useState<Resume | null>(null);
  const [resumeDraft, setResumeDraft] = useState<ResumeDraft | null>(null);
  const [loading, setLoading] = useState(Boolean(resumeId));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>('classic');
  const [hoveredTemplate, setHoveredTemplate] = useState<TemplateId | ''>('');
  const pendingTemplateSaveRef = useRef<Promise<void> | null>(null);
  const templateSaveRunRef = useRef(0);
  const activeTemplate = hoveredTemplate || selectedTemplate;
  const activeTemplateId = resolveTemplateId(activeTemplate || selectedTemplate, 'classic');
  const activeTemplateMeta = useMemo(() => templateList.find((template) => template.id === activeTemplateId), [activeTemplateId]);
  const ActiveTemplateComponent = templateRegistry[activeTemplateId].component;
  const previewResume = useMemo(() => (resumeDraft ? buildResumePreview(resumeDraft) : null), [resumeDraft]);
  const recommendation = useMemo(() => (resumeDraft ? recommendTemplates(resumeDraft) : null), [resumeDraft]);
  const setResumeStore = useResumeStore((state) => state.setResume);

  const applySavedTemplate = (updated: Resume, template: TemplateId, toastText = '') => {
    setResumeData(updated);
    const draft = resumeFromApi(updated);
    setResumeDraft(draft);
    setResumeStore(() => draft);
    setSelectedTemplate(template);
    if (toastText) setToast(toastText);
  };

  useEffect(() => {
    if (!resumeId) {
      setError('Resume ID not provided.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getResume(resumeId)
      .then((data) => {
        if (cancelled) return;
        setResumeData(data);
        const draft = resumeFromApi(data);
        setResumeDraft(draft);
        setResumeStore(() => draft);
        setSelectedTemplate(resolveTemplateId(data.templateId || '', 'classic'));
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
  }, [resumeId, setResumeStore]);

  useEffect(() => {
    if (!resumeData?.templateId) return;
    setSelectedTemplate(resolveTemplateId(resumeData.templateId, 'classic'));
  }, [resumeData]);

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
    const savePromise = api.updateResume(resumeId, { templateId: template })
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

  const handleSelectTemplate = (template: TemplateId) => {
    setSelectedTemplate(template);
    setResumeDraft((prev) => (prev ? { ...prev, templateId: template } : prev));
    setResumeStore((prev) => ({ ...prev, templateId: template }));
    persistTemplate(template).catch(() => undefined);
  };

  const handleSaveTemplate = async () => {
    if (!resumeId) return;
    setSaving(true);
    setError('');
    const runId = ++templateSaveRunRef.current;
    const savePromise = api.updateResume(resumeId, { templateId: selectedTemplate })
      .then((updated) => {
        applySavedTemplate(updated, selectedTemplate, 'Template saved');
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
    try {
      await savePromise;
    } catch {
      // surfaced in state
    }
  };

  const previewReady = Boolean(previewResume);
  if (!resumeId && !loading) {
    return (
      <main className="grid">
        <section className="card col-12">
          <h2>Select a resume to edit</h2>
          <p className="small">Specify a resume ID in the URL to choose a template.</p>
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
        <div className="template-grid" style={{ marginTop: 12 }}>
          {templateList.map((template) => {
            const TemplateComponent = template.component;
            return (
              <button
                key={template.id}
                type="button"
                className={`template-card ${template.id === selectedTemplate ? 'active' : ''}`}
                onMouseEnter={() => setHoveredTemplate(template.id)}
                onMouseLeave={() => setHoveredTemplate('')}
                onFocus={() => setHoveredTemplate(template.id)}
                onBlur={() => setHoveredTemplate('')}
                onClick={() => handleSelectTemplate(template.id)}
                disabled={loading}
              >
                <div className="template-card__preview">
                  {previewReady ? (
                    <TemplatePreviewFrame>
                      <div
                        data-template-id={template.id}
                        data-render-context="preview"
                        data-css-bundle="globals.css#ats-template"
                      >
                        <span style={{ display: 'none' }}>{`TEMPLATE_FINGERPRINT:${template.id}`}</span>
                        <TemplateComponent resumeData={previewResume!} />
                      </div>
                    </TemplatePreviewFrame>
                  ) : (
                    <p className="small">Resume preview unavailable.</p>
                  )}
                </div>
                <div className="template-card__meta">
                  <div>
                    <strong>{template.name}</strong>
                    <div className="small">{template.description}</div>
                    <div className="small template-card__availability">Available in PDF</div>
                    {template.id === recommendation?.primaryTemplateId && recommendation.reasons[0] && (
                      <p className="small template-card__reason">
                        Why recommended? {recommendation.reasons[0]}
                      </p>
                    )}
                  </div>
                  <div className="template-card__meta-badges">
                    <span className="pill">{template.id === selectedTemplate ? 'Applied' : 'Preview'}</span>
                    {template.id === recommendation?.primaryTemplateId && (
                      <span className="pill recommended" title={recommendation.reasons.join(' ')}>
                        Recommended
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card col-5 preview-pane">
        <div className="template-live">
          <div className="template-live__header">
            <div>
              <h4 style={{ margin: 0 }}>Live preview</h4>
              <p className="small">Now viewing {activeTemplateMeta?.name}</p>
              {recommendation && (
                <p className="small template-live__recommendation">
                  Recommended: {templateList.find((item) => item.id === recommendation.primaryTemplateId)?.name}.{' '}
                  {recommendation.reasons[0]}
                </p>
              )}
            </div>
            <span className="pill">{activeTemplateId === selectedTemplate ? 'Applied' : 'Previewing'}</span>
          </div>
          <div className="template-live__canvas">
            {previewResume ? (
              <TemplatePreviewFrame>
                <div
                  data-template-id={activeTemplateId}
                  data-render-context="preview"
                  data-css-bundle="globals.css#ats-template"
                >
                  <span style={{ display: 'none' }}>{`TEMPLATE_FINGERPRINT:${activeTemplateId}`}</span>
                  <ActiveTemplateComponent resumeData={previewResume} />
                </div>
              </TemplatePreviewFrame>
            ) : (
              <p className="small">Resume preview will appear once data loads.</p>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn secondary"
            onClick={async () => {
              if (!resumeId) {
                router.push(buildReviewAtsRoute('', resumeId));
                return;
              }
              try {
                if (pendingTemplateSaveRef.current) {
                  await pendingTemplateSaveRef.current;
                } else if (resolveTemplateId(String(resumeData?.templateId || ''), 'classic') !== selectedTemplate) {
                  await persistTemplate(selectedTemplate);
                }
                router.push(buildReviewAtsRoute('', resumeId));
              } catch {
                // keep user on page
              }
            }}
          >
            Back to editor
          </button>
          <button className="btn" onClick={handleSaveTemplate} disabled={!resumeDraft || saving}>
            {saving ? 'Saving...' : 'Save template'}
          </button>
          {toast && <span className="small" style={{ marginLeft: 'auto' }}>{toast}</span>}
        </div>
        {error && (
          <div className="message-banner" style={{ marginTop: 12 }}>
            <p className="small">{error}</p>
          </div>
        )}
      </section>
    </main>
  );
}
