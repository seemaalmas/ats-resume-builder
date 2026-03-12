'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ResumeImportResult } from 'resume-builder-shared';
import { api, getAccessToken, type Resume } from '@/src/lib/api';
import { buildResumePreview, resumeFromApi } from '@/src/lib/resume-flow';
import { TemplatePreview, type TemplateId } from './TemplatePreview';
import { TEMPLATE_PAGE_HEIGHT, TEMPLATE_PAGE_WIDTH, TemplatePreviewFrame } from './TemplatePreviewFrame';

type ResumeTemplateRenderProps = {
  templateId: TemplateId | string;
  resumeData?: ResumeImportResult | null;
  resumeId?: string;
  mode?: 'full' | 'thumbnail';
  compact?: boolean;
  accentOverride?: string;
  fontOverride?: string;
  spacing?: 'compact' | 'normal' | 'airy';
};

function toPreviewData(resume: Resume): ResumeImportResult {
  const draft = resumeFromApi(resume);
  return buildResumePreview(draft);
}

const THUMBNAIL_PAGE_WIDTH = 560;
const THUMBNAIL_PAGE_HEIGHT = TEMPLATE_PAGE_HEIGHT * (THUMBNAIL_PAGE_WIDTH / TEMPLATE_PAGE_WIDTH);

export default function ResumeTemplateRender({
  templateId,
  resumeData = null,
  resumeId = '',
  mode = 'full',
  compact = false,
  accentOverride,
  fontOverride,
  spacing = 'normal',
}: ResumeTemplateRenderProps) {
  const [fetchedPreviewData, setFetchedPreviewData] = useState<ResumeImportResult | null>(null);

  useEffect(() => {
    if (resumeData || !resumeId || !getAccessToken()) {
      setFetchedPreviewData(null);
      return;
    }
    let cancelled = false;
    api.getResume(resumeId)
      .then((resume) => {
        if (cancelled) return;
        setFetchedPreviewData(toPreviewData(resume));
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedPreviewData(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resumeData, resumeId]);

  const resolvedResume = useMemo(() => resumeData || fetchedPreviewData, [resumeData, fetchedPreviewData]);
  if (!resolvedResume) return null;
  const renderModeClassName =
    mode === 'thumbnail' ? 'resume-template-render resume-template-render--thumbnail' : 'resume-template-render';
  const resumeLabel = String(resolvedResume.title || resolvedResume.contact?.fullName || '').trim();
  const resumeSource = resumeData ? 'prop' : 'api';
  const previewFrameMode = mode === 'thumbnail' ? 'thumbnail' : 'full';
  const pageWidth = mode === 'thumbnail' ? THUMBNAIL_PAGE_WIDTH : TEMPLATE_PAGE_WIDTH;
  const pageHeight = mode === 'thumbnail' ? THUMBNAIL_PAGE_HEIGHT : TEMPLATE_PAGE_HEIGHT;

  return (
    <div
      className={renderModeClassName}
      data-renderer="resume-template-render"
      data-render-component="ResumeTemplateRender"
      data-render-mode={mode}
      data-template-id={String(templateId || '').trim()}
      data-resume-label={resumeLabel}
      data-resume-source={resumeSource}
      aria-hidden={mode === 'thumbnail' ? true : undefined}
    >
      <TemplatePreviewFrame mode={previewFrameMode} pageWidth={pageWidth} pageHeight={pageHeight}>
        <TemplatePreview
          templateId={templateId}
          resume={resolvedResume}
          compact={compact}
          accentOverride={accentOverride}
          fontOverride={fontOverride}
          spacing={spacing}
        />
      </TemplatePreviewFrame>
    </div>
  );
}
