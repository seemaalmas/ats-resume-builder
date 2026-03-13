'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  buildReviewAtsRoute,
  canContinueToReview,
  continueToReviewAtsFromStart,
  continueToReviewFromStart,
  type PendingUploadSession,
  type SectionType,
  buildEditorRoute,
  clearPendingUploadSession,
  formatRoleLevel,
  savePendingUploadSession,
  stagePendingUploadInStore,
} from '@/src/lib/resume-flow';
import { ingestResumeFile } from '@/src/lib/resume-ingest';
import { useResumeStore } from '@/src/lib/resume-store';

const SECTION_LABELS: Record<SectionType, string> = {
  contact: 'Header & Contact',
  summary: 'Summary',
  skills: 'Skills',
  languages: 'Languages',
  experience: 'Experience',
  education: 'Education',
  projects: 'Projects',
  certifications: 'Certifications',
};

export default function ResumeStartClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setResumeStore = useResumeStore((state) => state.setResume);
  const uploadedFileName = useResumeStore((state) => state.uploadedFileName);
  const setUploadedFileName = useResumeStore((state) => state.setUploadedFileName);
  const [session, setSession] = useState<PendingUploadSession | null>(null);
  const [loadingUpload, setLoadingUpload] = useState(false);
  const [error, setError] = useState('');
  const [pendingFileName, setPendingFileName] = useState('');

  const template = (searchParams.get('template') || '').trim();
  const uploadEditorHref = buildEditorRoute('review', template);
  const reviewAtsHref = buildReviewAtsRoute(template);
  const scratchEditorHref = buildEditorRoute('scratch', template);
  const uploadButtonLabel = loadingUpload
    ? `Processing ${pendingFileName || 'upload'}...`
    : uploadedFileName
      ? `Uploaded: ${uploadedFileName}`
      : pendingFileName
        ? `Selected: ${pendingFileName}`
        : 'Upload Resume';

  const populatedLabel = useMemo(() => {
    if (!session) return '';
    if (!session.uploadSummary.sectionsPopulated.length) return 'None';
    return session.uploadSummary.sectionsPopulated.map((type) => SECTION_LABELS[type]).join(', ');
  }, [session]);

  async function onUpload(file?: File) {
    if (!file) return;
    setPendingFileName(file.name);
    setLoadingUpload(true);
    setError('');
    try {
      const ingestResult = await ingestResumeFile(file);
      const pending: PendingUploadSession = {
        ...ingestResult.pendingSession,
        fileName: ingestResult.raw.fileName || file.name,
      };
      stagePendingUploadInStore(pending, setResumeStore);
      setSession(pending);
      setUploadedFileName(pending.fileName || file.name);
      const saved = savePendingUploadSession(pending);
      if (!saved) {
        setError('Upload processed, but browser session cache is unavailable. Continue in this tab to keep your parsed data.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setSession(null);
      clearPendingUploadSession();
    } finally {
      setLoadingUpload(false);
    }
  }

  return (
    <main className="grid">
      <section className="card col-12 start-shell">
        <div className="start-shell__head">
          <h2>Start your resume</h2>
          <p className="small">Are you uploading an existing resume?</p>
        </div>

        <div className="start-shell__choices">
          <div className="start-choice start-choice--upload">
            <div className="badge-row">
              <span className="pill">Recommended</span>
            </div>
            <h3>Upload existing resume</h3>
            <p className="small">
              We will parse and pre-fill your sections so you can review and polish quickly.
            </p>
            <label className="btn" style={{ cursor: 'pointer' }}>
              {uploadButtonLabel}
              <input
                type="file"
                accept=".pdf,.docx,.doc,.txt,.html,.htm,.rtf"
                onChange={(e) => onUpload(e.target.files?.[0])}
                disabled={loadingUpload}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          <div className="start-choice">
            <h3>Start from scratch</h3>
            <p className="small">
              Open a blank resume and complete sections step-by-step in guided mode.
            </p>
            <button
              className="btn secondary"
              onClick={() => {
                clearPendingUploadSession();
                router.push(scratchEditorHref);
              }}
            >
              Start from scratch
            </button>
          </div>
        </div>

        {session && (
          <div className="upload-summary-panel" style={{ marginTop: 20 }}>
            <div>
              <strong>Upload processed</strong>
              <p className="small">Detected experience level: {formatRoleLevel(session.uploadSummary.roleLevel)}.</p>
              <p className="small">Companies found: {session.uploadSummary.companyCount}. Experience entries: {session.uploadSummary.experienceCount}.</p>
              <p className="small">
                Signals: roles {session.uploadSummary.experienceSignals?.roleCount ?? 0}, dated roles {session.uploadSummary.experienceSignals?.rolesWithDateCount ?? 0}, estimated months {session.uploadSummary.experienceSignals?.estimatedTotalMonths ?? 0}.
              </p>
              <p className="small">Sections populated: {populatedLabel}.</p>
            </div>
            <div className="upload-summary-panel__actions">
              <button
                className="btn"
                onClick={() => {
                  const navigation = continueToReviewFromStart({
                    session,
                    template,
                    setResume: setResumeStore,
                    setUploadedFileName,
                  });
                  if (!navigation.enabled) return;
                  if (!navigation.cached) {
                    setError('Continuing without browser session cache. Keep this tab open while reviewing.');
                  }
                  router.push(navigation.href || uploadEditorHref);
                }}
                disabled={!canContinueToReview(session) || loadingUpload}
              >
                Continue to Review
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  const navigation = continueToReviewAtsFromStart({
                    session,
                    template,
                    setResume: setResumeStore,
                    setUploadedFileName,
                  });
                  if (!navigation.enabled) return;
                  if (!navigation.cached) {
                    setError('Continuing without browser session cache. Keep this tab open while reviewing.');
                  }
                  router.push(navigation.href || reviewAtsHref);
                }}
                disabled={!canContinueToReview(session) || loadingUpload}
              >
                Review & ATS
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="message-banner" style={{ marginTop: 16 }}>
            <p className="small">{error}</p>
          </div>
        )}
      </section>
    </main>
  );
}
