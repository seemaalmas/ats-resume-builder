import { Suspense } from 'react';
import ResumeStartClient from './ResumeStartClient';

export const dynamic = 'force-dynamic';

export default function ResumeStartPage() {
  return (
    <Suspense fallback={<div className="card">Loading resume start...</div>}>
      <ResumeStartClient />
    </Suspense>
  );
}
