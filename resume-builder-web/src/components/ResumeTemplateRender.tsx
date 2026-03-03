'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ResumeImportResult } from 'resume-builder-shared';
import { api, getAccessToken, type Resume } from '@/src/lib/api';
import { buildResumePreview, resumeFromApi } from '@/src/lib/resume-flow';
import { TemplatePreview, type TemplateId } from './TemplatePreview';
import { TemplatePreviewFrame } from './TemplatePreviewFrame';

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

  return (
    <div className={mode === 'thumbnail' ? 'resume-template-render resume-template-render--thumbnail' : 'resume-template-render'}>
      <TemplatePreviewFrame>
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
