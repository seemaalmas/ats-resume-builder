import { Suspense } from 'react';
import TemplateSelectionView from './TemplateSelectionView';

export const dynamic = 'force-dynamic';

export default function TemplateSelectionPage() {
  return (
    <Suspense fallback={<div className="card"><p className="small">Loading template selection...</p></div>}>
      <TemplateSelectionView />
    </Suspense>
  );
}
