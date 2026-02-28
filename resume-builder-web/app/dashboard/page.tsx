'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, Resume, getAccessToken } from '@/src/lib/api';
import { templates } from '@/src/components/TemplatePreview';

export default function DashboardPage() {
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
  const activeTemplate = hoveredTemplate || selectedTemplate;

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
                <TemplatePreview templateId={activeTemplate} resume={r} />
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
        <p className="small">Pick a starter template. Your latest resume content will be previewed.</p>
        <div className="grid" style={{ marginTop: 12 }}>
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className="card col-4"
              onMouseEnter={() => setHoveredTemplate(t.id)}
              onMouseLeave={() => setHoveredTemplate('')}
              onClick={() => setSelectedTemplate(t.id)}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                border: t.id === selectedTemplate ? '2px solid #2f5f8f' : undefined,
              }}
            >
              <strong>{t.name}</strong>
              <p className="small">{t.description}</p>
              <TemplatePreview templateId={t.id} resume={previewResume} />
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function TemplatePreview({
  templateId,
  resume,
}: {
  templateId: string;
  resume?: Resume;
}) {
  const accent = templateId === 'senior' ? '#1f3a5f' : templateId === 'student' ? '#2f7a5d' : '#111';
  if (!resume) {
    return (
      <div style={{ borderTop: `1px solid ${accent}`, paddingTop: 8, marginTop: 8 }}>
        <div className="small"><strong>No resume yet</strong></div>
        <div className="small" style={{ marginTop: 4 }}>Create or upload a resume to preview templates.</div>
      </div>
    );
  }
  const title = resume.title || resume.contact?.fullName || 'Untitled Resume';
  const summary = resume.summary || 'No summary added yet.';
  const skills = resume.skills?.length ? resume.skills.slice(0, 6).join(', ') : 'No skills added yet.';
  return (
    <div style={{ borderTop: `1px solid ${accent}`, paddingTop: 8, marginTop: 8 }}>
      <div className="small"><strong>{title}</strong></div>
      <div className="small" style={{ marginTop: 4 }}>{summary}</div>
      <div className="small" style={{ marginTop: 4, color: '#444' }}>{skills}</div>
    </div>
  );
}
