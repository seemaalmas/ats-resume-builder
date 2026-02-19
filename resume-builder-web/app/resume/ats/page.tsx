import { Suspense } from 'react';
import ResumeAtsClient from './ResumeAtsClient';

export const dynamic = 'force-dynamic';

export default function ResumeAtsPage() {
  return (
    <Suspense fallback={<div className="card">Loading ATS view...</div>}>
      <ResumeAtsClient />
    </Suspense>
  );
}
