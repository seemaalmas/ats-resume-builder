'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, getAccessToken, type Resume } from '@/src/lib/api';
import { templates, type TemplateId } from '@/src/components/TemplatePreview';
import ResumeTemplateRender from '@/src/components/ResumeTemplateRender';
import { buildResumePreview, resumeFromApi } from '@/src/lib/resume-flow';

const VALID_TEMPLATE_IDS = new Set(templates.map((template) => template.id));

function resolveTemplateId(value: string, fallback: TemplateId = 'classic'): TemplateId {
  const candidate = String(value || '').trim() as TemplateId;
  if (candidate && VALID_TEMPLATE_IDS.has(candidate)) {
    return candidate;
  }
  return fallback;
}

export default function TemplatePreviewPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeId = searchParams.get('resumeId') || '';
  const initialTemplate = resolveTemplateId(searchParams.get('template') || '');
  const [templateId, setTemplateId] = useState<TemplateId>(initialTemplate);
  const [resume, setResume] = useState<Resume | null>(null);
  const [activeResumeId, setActiveResumeId] = useState(resumeId);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setTemplateId(resolveTemplateId(searchParams.get('template') || '', templateId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    setActiveResumeId(resumeId);
  }, [resumeId]);

  useEffect(() => {
    if (!getAccessToken()) {
      setError('Please sign in to preview templates.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    const load = async () => {
      let targetResumeId = resumeId;
      if (!targetResumeId) {
        const list = await api.listResumes();
        targetResumeId = list[0]?.id || '';
        if (!targetResumeId) {
          throw new Error('No resumes found. Create a resume first.');
        }
      }
      const payload = await api.getResume(targetResumeId);
      if (cancelled) return;
      setActiveResumeId(targetResumeId);
      setResume(payload);
      const fallbackTemplate = resolveTemplateId(payload.templateId || '', 'classic');
      setTemplateId((prev) => resolveTemplateId(prev, fallbackTemplate));
    };
    load()
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load resume preview.');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  const previewResume = useMemo(() => {
    if (!resume) return null;
    const draft = resumeFromApi(resume);
    return buildResumePreview({ ...draft, templateId });
  }, [resume, templateId]);

  const handleApplyTemplate = async () => {
    if (!activeResumeId) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await api.updateResume(activeResumeId, { templateId });
      setResume(updated);
      setMessage('Template applied.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to apply template.');
    } finally {
      setSaving(false);
    }
  };

  const selectedTemplate = templates.find((item) => item.id === templateId) || templates[0];

  return (
    <main className="grid template-grid-layout">
      <section className="card col-7">
        <h2>Template Preview</h2>
        <p className="small">
          {loading ? 'Loading preview...' : `Viewing ${selectedTemplate?.name || 'template'} for your resume.`}
        </p>
        <div className="template-live__canvas" style={{ marginTop: 12 }}>
          {previewResume ? (
            <ResumeTemplateRender
              templateId={templateId}
              resumeData={previewResume}
              mode="full"
            />
          ) : (
            <p className="small">Preview unavailable.</p>
          )}
        </div>
      </section>
      <section className="card col-5">
        <h3 style={{ marginTop: 0 }}>Actions</h3>
        <p className="small">{selectedTemplate?.description || 'Select a template from dashboard preview cards.'}</p>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={handleApplyTemplate} disabled={!resume || !activeResumeId || saving || loading}>
            {saving ? 'Applying...' : 'Apply Template'}
          </button>
          <button
            className="btn secondary"
            onClick={() => router.push(activeResumeId ? `/resume?id=${encodeURIComponent(activeResumeId)}&template=${encodeURIComponent(templateId)}` : '/resume')}
            disabled={!activeResumeId}
          >
            Edit Resume
          </button>
          <button className="btn secondary" onClick={() => router.push('/dashboard')}>
            Back to Dashboard
          </button>
        </div>
        {message ? (
          <div className="message-banner" style={{ marginTop: 12 }}>
            <p className="small">{message}</p>
          </div>
        ) : null}
        {error ? (
          <div className="message-banner" style={{ marginTop: 12 }}>
            <p className="small">{error}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
