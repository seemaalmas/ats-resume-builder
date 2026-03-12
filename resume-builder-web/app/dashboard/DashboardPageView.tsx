'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TEMPLATE_CATALOG } from 'resume-builder-shared';
import { api, getAccessToken, type DriveSessionResponse, type Resume } from '@/src/lib/api';
import TemplateCatalogGrid from '@/src/components/templates/TemplateCatalogGrid';
import {
  buildResumePreview,
  buildTemplateSelectionRoute,
  clearActiveResumeSelection,
  persistActiveResumeSelection,
  resumeFromApi,
} from '@/src/lib/resume-flow';
import { recommendTemplates } from '@/src/lib/template-recommendation';
import { defaultTemplateId, resolveTemplateId, templateRegistry, type TemplateId } from '@/shared/templateRegistry';

const DASHBOARD_TEMPLATE_OPTIONS = TEMPLATE_CATALOG.map((template) => templateRegistry[template.id]);

type DriveSessionLike = DriveSessionResponse & {
  driveConnected?: boolean;
};

type DashboardApiClient = Pick<
  typeof api,
  | 'getDriveSession'
  | 'setDriveConsent'
  | 'getGoogleStartUrl'
  | 'listDriveFiles'
  | 'importDriveFile'
  | 'extendSession'
  | 'logout'
  | 'listResumes'
  | 'updateResume'
>;

type RouterLike = {
  push: (href: string) => Promise<boolean> | void;
};

const fallbackRouter: RouterLike = {
  push: async () => true,
};

const DRIVE_MODAL_SESSION_KEY = 'drive-consent-modal-dismissed';

export type DashboardPageProps = {
  apiClient?: DashboardApiClient;
  redirectTo?: (url: string) => void;
  resumeId?: string;
  routerOverride?: RouterLike;
};

export default function DashboardPageView({
  apiClient = api,
  redirectTo,
  resumeId = '',
  routerOverride,
}: DashboardPageProps = {}) {
  const nextRouter = process.env.NEXT_TEST_MOCK_ROUTER === '1' ? null : useRouter();
  const router = routerOverride ?? nextRouter ?? fallbackRouter;
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [resumesLoading, setResumesLoading] = useState(false);
  const [selectedResumeId, setSelectedResumeId] = useState(String(resumeId || '').trim());
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [showDriveConsentModal, setShowDriveConsentModal] = useState(false);
  const [consentLoading, setConsentLoading] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId | ''>('');
  const [hoveredTemplate, setHoveredTemplate] = useState<TemplateId | ''>('');

  useEffect(() => {
    let cancelled = false;
    if (!getAccessToken()) {
      setStatus('Please sign in to view your dashboard.');
      return;
    }

    setResumesLoading(true);
    apiClient
      .listResumes()
      .then((items) => {
        if (cancelled) return;
        setResumes(Array.isArray(items) ? items : []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load resumes.');
      })
      .finally(() => {
        if (!cancelled) setResumesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  useEffect(() => {
    let cancelled = false;
    if (!getAccessToken()) {
      return;
    }

    apiClient
      .getDriveSession()
      .then((session) => {
        if (cancelled) return;
        const driveSession = session as DriveSessionLike;
        const wasDismissed = typeof window !== 'undefined' && sessionStorage.getItem(DRIVE_MODAL_SESSION_KEY) === '1';
        if (!driveSession.driveConsentAsked && !wasDismissed) {
          setShowDriveConsentModal(true);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load dashboard session.');
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const sortedResumes = useMemo(
    () => [...resumes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [resumes],
  );

  useEffect(() => {
    if (!sortedResumes.length) {
      setSelectedResumeId('');
      if (!resumesLoading) {
        clearActiveResumeSelection();
      }
      return;
    }

    const hasSelected = selectedResumeId && sortedResumes.some((resume) => resume.id === selectedResumeId);
    if (hasSelected) return;
    const requestedResumeId = String(resumeId || '').trim();
    if (requestedResumeId && sortedResumes.some((resume) => resume.id === requestedResumeId)) {
      setSelectedResumeId(requestedResumeId);
      persistActiveResumeSelection(requestedResumeId);
      return;
    }
    setSelectedResumeId('');
    clearActiveResumeSelection();
  }, [resumesLoading, sortedResumes, selectedResumeId, resumeId]);

  const activeResume = useMemo(() => {
    if (!sortedResumes.length || !selectedResumeId) return null;
    return sortedResumes.find((resume) => resume.id === selectedResumeId) || null;
  }, [sortedResumes, selectedResumeId]);

  useEffect(() => {
    if (!activeResume) {
      setSelectedTemplate('');
      return;
    }
    setSelectedTemplate(resolveTemplateId(activeResume.templateId || '', defaultTemplateId));
  }, [activeResume]);

  const previewDraft = useMemo(() => (activeResume ? resumeFromApi(activeResume) : null), [activeResume]);
  const previewResume = useMemo(() => (previewDraft ? buildResumePreview(previewDraft) : null), [previewDraft]);
  const recommendation = useMemo(() => (previewDraft ? recommendTemplates(previewDraft) : null), [previewDraft]);
  const profileName = activeResume?.contact?.fullName || 'No resume selected';
  const profileRole = activeResume?.experience?.[0]?.role || '';
  const activeResumeUpdatedAt = activeResume?.updatedAt ? new Date(activeResume.updatedAt).toLocaleDateString() : '';
  const hasSelectedResume = Boolean(activeResume?.id);

  async function handleLater() {
    setError('');
    setConsentLoading(true);
    try {
      await apiClient.setDriveConsent({ decision: 'declined' });
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(DRIVE_MODAL_SESSION_KEY, '1');
      }
      setShowDriveConsentModal(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save your choice.');
    } finally {
      setConsentLoading(false);
    }
  }

  async function handleConnect() {
    setError('');
    setConsentLoading(true);
    try {
      const response = await apiClient.getGoogleStartUrl();
      await apiClient.setDriveConsent({ decision: 'accepted' });
      if (redirectTo) {
        redirectTo(response.url);
      } else if (typeof window !== 'undefined') {
        window.location.assign(response.url);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start Google sign-in.');
    } finally {
      setConsentLoading(false);
    }
  }

  function handleTemplatePreview(templateId: TemplateId) {
    setSelectedTemplate(templateId);
    setStatus('');
    setError('');
    const currentResumeId = String(selectedResumeId || activeResume?.id || '').trim();
    if (!currentResumeId) {
      setStatus('Select or create a resume before previewing a template.');
      return;
    }
    router.push(buildTemplateSelectionRoute(currentResumeId, templateId));
  }

  async function handleTemplateSelect(templateId: TemplateId) {
    setSelectedTemplate(templateId);
    setStatus('');
    setError('');
    if (!activeResume?.id) {
      setStatus('Select or create a resume before applying a template.');
      return;
    }

    setTemplateSaving(true);
    try {
      const updated = await apiClient.updateResume(activeResume.id, { templateId });
      setResumes((prev) => prev.map((resume) => (resume.id === activeResume.id ? updated : resume)));
      router.push(buildTemplateSelectionRoute(activeResume.id, templateId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to apply template.');
    } finally {
      setTemplateSaving(false);
    }
  }

  return (
    <main style={{ width: 'min(1160px, 94vw)', margin: '0 auto', padding: 24 }}>
      <header style={{ marginBottom: 14 }}>
        <h1 style={{ marginBottom: 4 }}>Dashboard</h1>
        <p className="small" style={{ margin: 0 }}>
          Choose a resume, then browse ATS-safe templates.
        </p>
      </header>

      <section
        data-testid="dashboard-preview-profile"
        style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, background: '#fff', marginBottom: 14 }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{profileName}</h2>
            {profileRole ? (
              <p className="small" style={{ margin: '6px 0 0' }}>
                {profileRole}
              </p>
            ) : (
              <p className="small" style={{ margin: '6px 0 0' }}>
                Select a saved resume or upload a new one to preview templates.
              </p>
            )}
            {activeResumeUpdatedAt ? (
              <p className="small" style={{ margin: '6px 0 0' }}>
                Last updated: {activeResumeUpdatedAt}
              </p>
            ) : null}
          </div>
          {sortedResumes.length > 0 ? (
            <label style={{ display: 'grid', gap: 6, minWidth: 260 }}>
              <span className="small">Selected resume</span>
              <select
                className="input"
                value={selectedResumeId}
                onChange={(event) => {
                  const nextResumeId = String(event.target.value || '').trim();
                  setSelectedResumeId(nextResumeId);
                  setStatus('');
                  setError('');
                  if (nextResumeId) {
                    persistActiveResumeSelection(nextResumeId);
                    return;
                  }
                  clearActiveResumeSelection();
                }}
                data-testid="dashboard-resume-select"
              >
                <option value="">Select a saved resume</option>
                {sortedResumes.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </section>

      <section className="card" data-testid="dashboard-template-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Choose a template</h2>
            <p className="small" style={{ margin: '6px 0 0' }}>
              Same catalog as template selection, optimized for ATS-safe export.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn secondary" href="/resume/start">
              Create Resume
            </Link>
            <button
              className="btn"
              type="button"
              onClick={() => {
                if (activeResume?.id) {
                  router.push(buildTemplateSelectionRoute(activeResume.id));
                  return;
                }
                router.push('/resume/start');
              }}
            >
              Start from Template
            </button>
          </div>
        </div>

        {resumesLoading ? <p className="small" style={{ marginTop: 12 }}>Loading resumes...</p> : null}
        {!activeResume?.id ? (
          <p className="small template-empty" style={{ marginTop: 12 }}>
            Select a saved resume or upload a new one to preview templates.
          </p>
        ) : null}

        {previewResume || resumesLoading ? (
          <div style={{ marginTop: 12 }}>
            <TemplateCatalogGrid
              templates={DASHBOARD_TEMPLATE_OPTIONS}
              previewResume={previewResume}
              selectedTemplate={selectedTemplate}
              recommendation={recommendation}
              hoveredTemplate={hoveredTemplate}
              onHoverTemplate={(templateId) => setHoveredTemplate(templateId)}
              onPreviewTemplate={handleTemplatePreview}
              onSelectTemplate={handleTemplateSelect}
              primaryActionLabel="Use Template"
              layoutVariant="gallery"
              disabled={templateSaving || resumesLoading || !hasSelectedResume}
              previewLoading={resumesLoading}
              dataTestId="dashboard-template-grid"
            />
          </div>
        ) : null}
      </section>

      {status && (
        <p className="small" style={{ marginTop: 12 }}>
          {status}
        </p>
      )}

      {error && (
        <p className="small" style={{ marginTop: 12, color: '#b91c1c' }}>
          {error}
        </p>
      )}

      {showDriveConsentModal && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="drive-consent-modal"
          style={{
            marginTop: 20,
            border: '1px solid #d1d5db',
            borderRadius: 12,
            padding: 16,
            background: '#fafafa',
          }}
        >
          <h3 style={{ marginTop: 0 }}>Connect Google Drive?</h3>
          <p className="small" style={{ marginTop: 8 }}>
            Import resumes from Drive to speed up setup.
          </p>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="btn secondary" type="button" onClick={handleLater} disabled={consentLoading}>
              Later
            </button>
            <button className="btn" type="button" onClick={handleConnect} disabled={consentLoading}>
              Connect
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
