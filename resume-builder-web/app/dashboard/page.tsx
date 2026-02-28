'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, Resume, getAccessToken } from '@/src/lib/api';
import { TemplatePreview, templates, type TemplateId } from '@/src/components/TemplatePreview';
import { buildTemplateSelectionRoute, resumeFromApi, buildResumePreview } from '@/src/lib/resume-flow';

export default function DashboardPage() {
  const router = useRouter();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [message, setMessage] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(templates[0]?.id || 'classic');
  const [hoveredTemplate, setHoveredTemplate] = useState('');
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

  const templateQuery = useMemo(() => `?template=${selectedTemplate}`, [selectedTemplate]);
  const previewResume = resumes[0] || undefined;
  const previewData = useMemo(() => {
    if (!previewResume) return null;
    const draft = resumeFromApi(previewResume);
    return buildResumePreview(draft);
  }, [previewResume]);
  const activeTemplate = hoveredTemplate || selectedTemplate;

  const handleTemplateClick = (templateId: TemplateId) => {
    setSelectedTemplate(templateId);
    if (previewResume) {
      router.push(buildTemplateSelectionRoute(previewResume.id));
    } else {
      router.push(`/resume/start?template=${templateId}`);
    }
  };

  return (
    <main className="grid">
      {/* ── Resume header (shown when user has resumes) ── */}
      {previewResume && (
        <section className="col-12" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{previewResume.title}</h2>
          <p className="small" style={{ margin: 0 }}>
            Created: {new Date(previewResume.createdAt).toLocaleDateString()}
            {'  \u00A0\u00A0  '}
            Last Edited: {new Date(previewResume.updatedAt).toLocaleDateString()}{' '}
            {new Date(previewResume.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </section>
      )}

      {/* ── Template gallery grid (primary content — 4 columns) ── */}
      <section className="col-12" data-testid="dashboard-template-section">
        <div
          className="template-grid"
          data-testid="dashboard-template-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '20px',
            marginTop: 8,
          }}
        >
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`template-card ${t.id === selectedTemplate ? 'active' : ''}`}
              data-template-id={t.id}
              onMouseEnter={() => setHoveredTemplate(t.id)}
              onMouseLeave={() => setHoveredTemplate('')}
              onClick={() => handleTemplateClick(t.id)}
              style={{ padding: 0, borderRadius: 12, overflow: 'hidden' }}
            >
              <div
                className="template-card__preview"
                style={{
                  height: 'auto',
                  minHeight: 320,
                  overflow: 'hidden',
                  padding: 0,
                  background: '#fff',
                  borderRadius: 0,
                  border: 'none',
                }}
              >
                {previewData ? (
                  <div style={{ transform: 'scale(0.48)', transformOrigin: 'top left', width: '208%' }}>
                    <TemplatePreview
                      templateId={t.id}
                      resume={previewData}
                    />
                  </div>
                ) : (
                  <div style={{ padding: 16 }}>
                    <div style={{ transform: 'scale(0.48)', transformOrigin: 'top left', width: '208%' }}>
                      <TemplatePreview
                        templateId={t.id}
                        resume={{
                          title: 'Your Resume Title',
                          summary: 'Your professional summary will appear here once you create a resume.',
                          skills: ['Skill 1', 'Skill 2', 'Skill 3'],
                          experience: [],
                          education: [],
                          projects: [],
                          certifications: [],
                          contact: { fullName: 'Your Name', email: 'email@example.com', phone: '', location: '' },
                        }}
                        compact
                      />
                    </div>
                  </div>
                )}
              </div>
              <div
                className="template-card__meta"
                style={{
                  padding: '10px 14px',
                  borderTop: '1px solid #efe4d9',
                  background: '#faf8f5',
                }}
              >
                <div style={{ textAlign: 'left' }}>
                  <strong>{t.name}</strong>
                </div>
                <span className="small" style={{ color: '#777', whiteSpace: 'nowrap' }}>
                  Available in PDF
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ── Your resumes list ── */}
      <section className="card col-7">
        <div className="dashboard-header">
          <div>
            <h2>Your resumes</h2>
            <p className="small">Create, duplicate, and manage all versions in one place.</p>
          </div>
          <Link className="btn" href={`/resume/start${templateQuery}`}>Create new</Link>
        </div>
        {message && <p className="small">{message}</p>}
        <div className="resume-grid">
          {resumes.map((r) => (
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
      </section>
      <section className="card col-5">
        <h3>Create new</h3>
        <p className="small">Start from a clean ATS-safe template.</p>
        <Link className="btn" href={`/resume/start${templateQuery}`}>New resume</Link>
      </section>
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
  return (
    <TemplatePreview
      templateId={templateId}
      resume={data}
      compact
    />
  );
}
