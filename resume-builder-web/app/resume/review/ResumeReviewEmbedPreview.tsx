'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, getAccessToken, type Resume } from '@/src/lib/api';
import { TemplatePreview, templates, type TemplateId } from '@/src/components/TemplatePreview';
import { buildResumePreview, resumeFromApi } from '@/src/lib/resume-flow';
import { getEmptyResumeDraft, type ResumeDraft } from '@/src/lib/resume-store';

type ResumeReviewEmbedPreviewProps = {
  templateId: string;
  resumeId: string;
  mode: string;
};

const VALID_TEMPLATE_IDS = new Set(templates.map((entry) => entry.id));

function resolveTemplateId(templateId: string, fallbackTemplateId?: string): TemplateId {
  const requested = String(templateId || fallbackTemplateId || 'classic').trim() as TemplateId;
  if (VALID_TEMPLATE_IDS.has(requested)) {
    return requested;
  }
  return 'classic';
}

export default function ResumeReviewEmbedPreview({ templateId, resumeId, mode }: ResumeReviewEmbedPreviewProps) {
  const [resumeDraft, setResumeDraft] = useState<ResumeDraft>(() => getEmptyResumeDraft());
  const [loadedResume, setLoadedResume] = useState<Resume | null>(null);
  const [loadError, setLoadError] = useState('');
  const resolvedTemplateId = useMemo(
    () => resolveTemplateId(templateId, loadedResume?.templateId || resumeDraft.templateId),
    [templateId, loadedResume?.templateId, resumeDraft.templateId],
  );
  const previewData = useMemo(
    () => buildResumePreview({ ...resumeDraft, templateId: resolvedTemplateId }),
    [resumeDraft, resolvedTemplateId],
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.add('resume-embed-body');
    return () => {
      document.body.classList.remove('resume-embed-body');
    };
  }, []);

  useEffect(() => {
    if (!resumeId) return;
    if (!getAccessToken()) return;
    let cancelled = false;
    api.getResume(resumeId)
      .then((resume) => {
        if (cancelled) return;
        setLoadedResume(resume);
        setResumeDraft(resumeFromApi(resume));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load resume');
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  return (
    <main className={`resume-embed-root ${mode === 'thumbnail' ? 'resume-embed-root--thumbnail' : ''}`}>
      <section className="resume-embed-page">
        <TemplatePreview templateId={resolvedTemplateId} resume={previewData} />
      </section>
      {loadError ? <p className="small resume-embed-error">{loadError}</p> : null}
    </main>
  );
}
