import { Suspense } from 'react';
import TemplatePreviewPageClient from './TemplatePreviewPageClient';

export const dynamic = 'force-dynamic';

export default function TemplatesPreviewPage() {
  return (
    <Suspense fallback={<div className="card">Loading template preview...</div>}>
      <TemplatePreviewPageClient />
    </Suspense>
  );
}
