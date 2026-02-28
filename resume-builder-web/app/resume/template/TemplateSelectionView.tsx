'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type Resume } from '@/src/lib/api';
import {
  buildReviewAtsRoute,
  buildResumePreview,
  resumeFromApi,
} from '@/src/lib/resume-flow';
import { useResumeStore, type ResumeDraft } from '@/src/lib/resume-store';
import { TemplatePreview, templates, type TemplateId } from '@/src/components/TemplatePreview';

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
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewAccent, setPreviewAccent] = useState('#111');
  const [previewFont, setPreviewFont] = useState('template');
  const [previewSpacing, setPreviewSpacing] = useState<'compact' | 'normal' | 'airy'>('normal');
  const previewStyle = { '--page-height': `${Math.round(1120 * previewZoom)}px` } as CSSProperties;
  const activeTemplate = hoveredTemplate || selectedTemplate;
  const previewResume = useMemo(() => (resumeDraft ? buildResumePreview(resumeDraft) : null), [resumeDraft]);
  const setResumeStore = useResumeStore((state) => state.setResume);

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
        setSelectedTemplate((data.templateId as TemplateId) || 'classic');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load resume.');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, setResumeStore]);

  useEffect(() => {
    if (resumeData?.templateId) {
      setSelectedTemplate((resumeData.templateId as TemplateId) || 'classic');
    }
  }, [resumeData]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleSelectTemplate = (template: TemplateId) => {
    setSelectedTemplate(template);
    setResumeDraft((prev) => (prev ? { ...prev, templateId: template } : prev));
    setResumeStore((prev) => ({ ...prev, templateId: template }));
  };

  const handleSaveTemplate = async () => {
    if (!resumeId) return;
    setSaving(true);
    setError('');
    try {
      await api.updateResume(resumeId, { templateId: selectedTemplate });
      setToast('Template saved');
      setResumeDraft((prev) => (prev ? { ...prev, templateId: selectedTemplate } : prev));
      setResumeStore((prev) => ({ ...prev, templateId: selectedTemplate }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save template.');
    } finally {
      setSaving(false);
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
          {templates.map((template) => (
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
                {previewReady && (
                  <TemplatePreview
                    templateId={template.id}
                    resume={previewResume!}
                    compact
                    accentOverride={previewAccent}
                    fontOverride={previewFont}
                    spacing={previewSpacing}
                  />
                )}
              </div>
              <div className="template-card__meta">
                <div>
                  <strong>{template.name}</strong>
                  <div className="small">{template.description}</div>
                </div>
                <span className="pill">{template.id === selectedTemplate ? 'Applied' : 'Preview'}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="card col-5 preview-pane">
        <div className="template-live">
          <div className="template-live__header">
            <div>
              <h4 style={{ margin: 0 }}>Live preview</h4>
              <p className="small">Now viewing {templates.find((t) => t.id === activeTemplate)?.name}</p>
            </div>
            <span className="pill">{activeTemplate === selectedTemplate ? 'Applied' : 'Previewing'}</span>
          </div>
          <div className="preview-controls">
            <div className="control">
              <label className="label">Zoom</label>
              <div className="control-row">
                <button className="btn secondary" onClick={() => setPreviewZoom((z) => Math.max(0.7, Number((z - 0.1).toFixed(2))))}>-</button>
                <input
                  className="range"
                  type="range"
                  min="0.7"
                  max="1.3"
                  step="0.05"
                  value={previewZoom}
                  onChange={(e) => setPreviewZoom(Number(e.target.value))}
                />
                <button className="btn secondary" onClick={() => setPreviewZoom((z) => Math.min(1.3, Number((z + 0.1).toFixed(2))))}>+</button>
                <span className="small">{Math.round(previewZoom * 100)}%</span>
              </div>
            </div>
            <div className="control">
              <label className="label">Theme color</label>
              <div className="control-row">
                {['#111', '#2b3a55', '#1f3a5f', '#2f7a5d', '#7a3e20'].map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`swatch ${previewAccent === color ? 'active' : ''}`}
                    style={{ background: color }}
                    onClick={() => setPreviewAccent(color)}
                    aria-label={`Set theme color ${color}`}
                  />
                ))}
              </div>
            </div>
            <div className="control">
              <label className="label">Font</label>
              <select className="input" value={previewFont} onChange={(e) => setPreviewFont(e.target.value)}>
                <option value="template">Template default</option>
                <option value="IBM Plex Sans">IBM Plex Sans</option>
                <option value="Source Sans 3">Source Sans 3</option>
                <option value="Work Sans">Work Sans</option>
                <option value="Georgia">Georgia</option>
                <option value="Times New Roman">Times New Roman</option>
              </select>
            </div>
            <div className="control">
              <label className="label">Section spacing</label>
              <div className="control-row">
                {(['compact', 'normal', 'airy'] as const).map((spacing) => (
                  <button
                    key={spacing}
                    type="button"
                    className={`btn secondary ${previewSpacing === spacing ? 'active' : ''}`}
                    onClick={() => setPreviewSpacing(spacing)}
                  >
                    {spacing}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="template-live__canvas page-breaks" style={previewStyle}>
            <div className="preview-zoom" style={{ transform: `scale(${previewZoom})` }}>
              {previewResume ? (
                <TemplatePreview
                  templateId={activeTemplate}
                  resume={previewResume}
                  accentOverride={previewAccent}
                  fontOverride={previewFont}
                  spacing={previewSpacing}
                />
              ) : (
                <p className="small">Resume preview will appear once data loads.</p>
              )}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn secondary"
            onClick={() => router.push(buildReviewAtsRoute('', resumeId))}
          >
            Back to editor
          </button>
          <button
            className="btn"
            onClick={handleSaveTemplate}
            disabled={!resumeDraft || saving}
          >
            {saving ? 'Saving...' : 'Save template'}
          </button>
          {toast && (
            <span className="small" style={{ marginLeft: 'auto' }}>
              {toast}
            </span>
          )}
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
