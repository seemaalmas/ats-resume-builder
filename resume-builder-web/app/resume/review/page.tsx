import { Suspense } from 'react';
import ResumeEditor from '../ResumeEditor';
import ResumeReviewEmbedPreview from './ResumeReviewEmbedPreview';

export const dynamic = 'force-dynamic';

type ResumeReviewPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export default function ResumeReviewPage({ searchParams }: ResumeReviewPageProps) {
  const embed = readSearchParam(searchParams?.embed) === '1';
  if (embed) {
    return (
      <ResumeReviewEmbedPreview
        templateId={readSearchParam(searchParams?.template)}
        resumeId={readSearchParam(searchParams?.id)}
        mode={readSearchParam(searchParams?.mode)}
      />
    );
  }
  return (
    <Suspense fallback={<div className="card">Loading review workspace...</div>}>
      <ResumeEditor />
    </Suspense>
  );
}
