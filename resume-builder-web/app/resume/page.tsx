import { Suspense } from 'react';
import ResumeEditor from './ResumeEditor';

export const dynamic = 'force-dynamic';

export default function ResumePage() {
  return (
    <Suspense fallback={<div className="card">Loading resume editor...</div>}>
      <ResumeEditor />
    </Suspense>
  );
}
