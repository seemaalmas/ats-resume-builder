import { Suspense } from 'react';
import ResumeEditor from '../ResumeEditor';
import ResumeReviewEmbedPreview from './ResumeReviewEmbedPreview';

export const dynamic = 'force-dynamic';

type ResumeReviewPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export default async function ResumeReviewPage({ searchParams }: ResumeReviewPageProps) {
  const params = (await searchParams) || {};
  const embed = readSearchParam(params.embed) === '1';
  if (embed) {
    return (
      <ResumeReviewEmbedPreview
        templateId={readSearchParam(params.template)}
        resumeId={readSearchParam(params.id)}
        mode={readSearchParam(params.mode)}
      />
    );
  }
  return (
    <Suspense fallback={<div className="card">Loading review workspace...</div>}>
      <ResumeEditor />
    </Suspense>
  );
}
