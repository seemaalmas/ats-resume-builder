'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, Resume, getAccessToken } from '@/src/lib/api';
import { TemplatePreviewFrame } from '@/src/components/TemplatePreviewFrame';
import { buildTemplateSelectionRoute, resumeFromApi, buildResumePreview } from '@/src/lib/resume-flow';
import { recommendTemplates } from '@/src/lib/template-recommendation';
import { resolveTemplateId, templateList, templateRegistry, type TemplateId } from '@/shared/templateRegistry';

export default function DashboardPage() {
  const router = useRouter();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [message, setMessage] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>(resolveTemplateId(templateList[0]?.id || 'classic'));
  const [hoveredTemplate, setHoveredTemplate] = useState<TemplateId | ''>('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dupLoading, setDupLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!getAccessToken()) {
      setMessage('Please sign in to view your dashboard.');
      return;
    }
    api.listResumes()
      .then(setResumes)
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Failed to load'));
  }, []);

  const sortedResumes = useMemo(
    () => [...resumes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [resumes],
  );
  const templateQuery = useMemo(() => `?template=${selectedTemplate}`, [selectedTemplate]);
  const previewResume = sortedResumes[0] || undefined;
  const previewDraft = useMemo(() => (previewResume ? resumeFromApi(previewResume) : null), [previewResume]);
  const previewData = useMemo(() => (previewDraft ? buildResumePreview(previewDraft) : null), [previewDraft]);
  const recommendation = useMemo(() => (previewDraft ? recommendTemplates(previewDraft) : null), [previewDraft]);
  const activeTemplate: TemplateId = (hoveredTemplate || selectedTemplate) as TemplateId;

  const handleTemplateClick = async (templateId: TemplateId) => {
    setSelectedTemplate(templateId);
    if (previewResume) {
      try {
        const updated = await api.updateResume(previewResume.id, { templateId });
        setResumes((prev) => prev.map((item) => (item.id === previewResume.id ? updated : item)));
      } catch (err: unknown) {
        setMessage(err instanceof Error ? err.message : 'Failed to apply selected template.');
        return;
      }
      router.push(buildTemplateSelectionRoute(previewResume.id));
    } else {
      router.push(`/resume/start?template=${templateId}`);
    }
  };

  return (
    <main style={{ width: '90vw', maxWidth: 'none', margin: '0 auto', padding: 24 }}>
      {/* ── Resume header ── */}
      {previewResume && (
        <header style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{previewResume.title}</h2>
          <p className="small" style={{ margin: 0 }}>
            Created: {new Date(previewResume.createdAt).toLocaleDateString()}
            {'  \u00A0\u00A0  '}
            Last Edited: {new Date(previewResume.updatedAt).toLocaleDateString()}{' '}
            {new Date(previewResume.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </header>
      )}

      {message && <p className="small">{message}</p>}

      {/* ── Template gallery grid — primary / default dashboard view ── */}
      <section data-testid="dashboard-template-section">
        <div
          data-testid="dashboard-template-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 20,
          }}
        >
          {templateList.map((t) => {
            const TemplateComponent = t.component;
            return (
              <button
                key={t.id}
                type="button"
                className={`template-card ${t.id === selectedTemplate ? 'active' : ''}`}
                data-template-id={t.id}
                onMouseEnter={() => setHoveredTemplate(t.id)}
                onMouseLeave={() => setHoveredTemplate('')}
                onClick={() => handleTemplateClick(t.id)}
              >
                <div className="template-card__preview">
                  {previewData ? (
                    <TemplatePreviewFrame>
                      <div
                        data-template-id={t.id}
                        data-render-context="preview"
                        data-css-bundle="globals.css#ats-template"
                      >
                        <span style={{ display: 'none' }}>{`TEMPLATE_FINGERPRINT:${t.id}`}</span>
                        <TemplateComponent resumeData={previewData} />
                      </div>
                    </TemplatePreviewFrame>
                  ) : (
                    <p className="small">Resume preview unavailable.</p>
                  )}
                </div>
                <div className="template-card__meta">
                  <div>
                    <strong>{t.name}</strong>
                    <div className="small">{t.description}</div>
                    <div className="small template-card__availability">Available in PDF</div>
                    {t.id === recommendation?.primaryTemplateId && recommendation.reasons[0] && (
                      <p className="small template-card__reason">
                        Why recommended? {recommendation.reasons[0]}
                      </p>
                    )}
                  </div>
                  <div className="template-card__meta-badges">
                    <span className="pill">{t.id === selectedTemplate ? 'Applied' : 'Preview'}</span>
                    {t.id === recommendation?.primaryTemplateId && (
                      <span className="pill recommended" title={recommendation.reasons.join(' ')}>
                        Recommended
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Your resumes (collapsible, below the template grid) ── */}
      {sortedResumes.length > 0 && (
        <details style={{ marginTop: 32 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 18, marginBottom: 12 }}>
            Your resumes ({sortedResumes.length})
          </summary>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <Link className="btn" href={`/resume/start${templateQuery}`}>Create new</Link>
          </div>
          <div className="resume-grid">
            {sortedResumes.map((r) => (
              <div key={r.id} className="card resume-card">
                <div className="resume-thumb">
                  <DashboardResumeThumb templateId={activeTemplate} resume={r} />
                </div>
                <div className="resume-card__meta">
                  {renamingId === r.id ? (
                    <div className="rename-row">
                      <input
                        className="input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            const updated = await api.updateResume(r.id, {
                              title: renameValue,
                              summary: r.summary,
                              skills: r.skills,
                              experience: r.experience,
                              education: r.education,
                              projects: r.projects,
                              certifications: r.certifications,
                              contact: r.contact,
                            });
                            setResumes((prev) => prev.map((item) => (item.id === r.id ? updated : item)));
                            setRenamingId(null);
                          }
                        }}
                      />
                      <button className="btn secondary" onClick={() => setRenamingId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="resume-title-row">
                      <strong>{r.title}</strong>
                      <button
                        className="btn secondary"
                        onClick={() => {
                          setRenamingId(r.id);
                          setRenameValue(r.title);
                        }}
                      >
                        Rename
                      </button>
                    </div>
                  )}
                  <p className="small">Updated: {new Date(r.updatedAt).toLocaleDateString()}</p>
                  <div className="resume-actions">
                    <Link className="btn" href={`/resume?id=${r.id}`}>Edit</Link>
                    <button
                      className="btn secondary"
                      onClick={async () => {
                        setDupLoading(r.id);
                        try {
                          const copy = await api.duplicateResume(r.id);
                          setResumes((prev) => [copy, ...prev]);
                        } finally {
                          setDupLoading(null);
                        }
                      }}
                      disabled={dupLoading === r.id}
                    >
                      {dupLoading === r.id ? 'Duplicating...' : 'Duplicate'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </main>
  );
}

function DashboardResumeThumb({
  templateId,
  resume,
}: {
  templateId: string;
  resume: Resume;
}) {
  const draft = useMemo(() => resumeFromApi(resume), [resume]);
  const data = useMemo(() => buildResumePreview(draft), [draft]);
  const resolvedTemplateId = resolveTemplateId(templateId);
  const TemplateComponent = templateRegistry[resolvedTemplateId].component;
  return (
    <TemplatePreviewFrame>
      <div
        data-template-id={resolvedTemplateId}
        data-render-context="preview"
        data-css-bundle="globals.css#ats-template"
      >
        <span style={{ display: 'none' }}>{`TEMPLATE_FINGERPRINT:${resolvedTemplateId}`}</span>
        <TemplateComponent resumeData={data} />
      </div>
    </TemplatePreviewFrame>
  );
}
