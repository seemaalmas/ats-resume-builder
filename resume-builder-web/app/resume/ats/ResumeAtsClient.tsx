'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type AtsScoreResult } from '@/src/lib/api';

export default function ResumeAtsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeId = (searchParams.get('id') || '').trim();
  const [jdText, setJdText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [score, setScore] = useState<AtsScoreResult | null>(null);

  const runScore = useCallback(async () => {
    if (!resumeId) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.atsScore(resumeId, jdText || undefined);
      setScore(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to compute ATS score.');
    } finally {
      setLoading(false);
    }
  }, [resumeId, jdText]);

  useEffect(() => {
    runScore().catch(() => undefined);
  }, [runScore]);

  if (!resumeId) {
    return (
      <main className="grid">
        <section className="card col-12">
          <h2>ATS Review</h2>
          <p className="small">No resume id found. Open ATS from the editor using Continue to ATS.</p>
          <button className="btn" onClick={() => router.push('/resume')}>Back to Editor</button>
        </section>
      </main>
    );
  }

  return (
    <main className="grid">
      <section className="card col-12">
        <div className="editor-header">
          <div>
            <h2>ATS Review</h2>
            <p className="small">Resume id: {resumeId}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn secondary" onClick={() => router.push(`/resume?id=${encodeURIComponent(resumeId)}`)}>
              Back to Review
            </button>
            <button className="btn" onClick={() => runScore()} disabled={loading}>
              {loading ? 'Running...' : 'Re-run ATS'}
            </button>
          </div>
        </div>

        <label className="label" style={{ marginTop: 12 }}>Job Description (optional)</label>
        <textarea
          className="input"
          style={{ minHeight: 120 }}
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          placeholder="Paste job description for keyword matching"
        />

        {error && (
          <div className="message-banner" style={{ marginTop: 12 }}>
            <p className="small">{error}</p>
          </div>
        )}

        {score && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Current ATS Result</h3>
            <p className="small">Role level: {score.roleLevel}</p>
            <p className="small">ATS score: {score.roleAdjustedScore}</p>
            <p className="small">Base score: {score.atsScore}</p>

            <h4 style={{ marginBottom: 6 }}>Rejection Reasons</h4>
            <ul>
              {score.rejectionReasons.length
                ? score.rejectionReasons.map((item, idx) => <li key={`reason-${idx}`}>{item}</li>)
                : <li>No blocking reasons detected.</li>}
            </ul>

            <h4 style={{ marginBottom: 6 }}>Suggestions</h4>
            <ul>
              {score.improvementSuggestions.length
                ? score.improvementSuggestions.map((item, idx) => <li key={`suggestion-${idx}`}>{item}</li>)
                : <li>No major suggestions.</li>}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
