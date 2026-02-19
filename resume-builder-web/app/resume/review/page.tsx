import { Suspense } from 'react';
import ResumeEditor from '../ResumeEditor';

export const dynamic = 'force-dynamic';

export default function ResumeReviewPage() {
  return (
    <Suspense fallback={<div className="card">Loading review workspace...</div>}>
      <ResumeEditor />
    </Suspense>
  );
}
