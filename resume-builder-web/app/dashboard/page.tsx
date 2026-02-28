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

      <section className="card col-12">
        <h3>Templates</h3>
        <p className="small">Pick a template to preview and apply. Click any card to open the full preview experience.</p>
        <div className="template-grid" data-testid="dashboard-template-grid" style={{ marginTop: 12 }}>
          {templates.map((t) => (
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
                {previewData && (
                  <TemplatePreview
                    templateId={t.id}
                    resume={previewData}
                    compact
                  />
                )}
              </div>
              <div className="template-card__meta">
                <div>
                  <strong>{t.name}</strong>
                  <div className="small">{t.description}</div>
                </div>
                <span className="pill">{t.id === selectedTemplate ? 'Selected' : 'Preview'}</span>
              </div>
            </button>
          ))}
        </div>
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
