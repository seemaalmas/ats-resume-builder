
'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, Resume, ResumeImportResult, UploadResumeResponse, getAccessToken } from '@/src/lib/api';
import { useResumeStore } from '@/src/lib/resume-store';

type ContactInfo = {
  fullName: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: string[];
};

type ExperienceItem = {
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  highlights: string[];
};

type EducationItem = {
  institution: string;
  degree: string;
  startDate: string;
  endDate: string;
  details: string[];
};

type ProjectItem = {
  name: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  highlights: string[];
};

type CertificationItem = {
  name: string;
  issuer?: string;
  date?: string;
  details?: string[];
};

type ResumeDraft = {
  title: string;
  contact: ContactInfo;
  summary: string;
  skills: string[];
  experience: ExperienceItem[];
  education: EducationItem[];
  projects: ProjectItem[];
  certifications: CertificationItem[];
};

type SectionType =
  | 'contact'
  | 'summary'
  | 'skills'
  | 'experience'
  | 'education'
  | 'projects'
  | 'certifications';

type SectionState = {
  id: string;
  type: SectionType;
  enabled: boolean;
  required: boolean;
};

type FeedbackLevel = 'good' | 'warn' | 'error';

const emptyExperience: ExperienceItem = { company: '', role: '', startDate: '', endDate: '', highlights: [''] };
const emptyEducation: EducationItem = { institution: '', degree: '', startDate: '', endDate: '', details: [''] };
const emptyProject: ProjectItem = { name: '', role: '', startDate: '', endDate: '', highlights: [''] };
const emptyCertification: CertificationItem = { name: '', issuer: '', date: '', details: [''] };

type TemplateId = 'classic' | 'modern' | 'student' | 'senior';

const templates: Array<{
  id: TemplateId;
  name: string;
  description: string;
  accent: string;
  fontFamily: string;
}> = [
  { id: 'classic', name: 'Classic ATS', description: 'Clean single-column layout.', accent: '#111', fontFamily: '"IBM Plex Sans", "Segoe UI", Arial, sans-serif' },
  { id: 'modern', name: 'Modern Professional', description: 'Sharper headings with ATS-safe spacing.', accent: '#2b3a55', fontFamily: '"Source Sans 3", "Segoe UI", Arial, sans-serif' },
  { id: 'student', name: 'Student Starter', description: 'Project-first layout for early careers.', accent: '#2f7a5d', fontFamily: '"Work Sans", "Segoe UI", Arial, sans-serif' },
  { id: 'senior', name: 'Senior Impact', description: 'Experience and impact-driven layout.', accent: '#1f3a5f', fontFamily: '"Literata", "Times New Roman", serif' },
];

const SECTION_LABELS: Record<SectionType, string> = {
  contact: 'Header & Contact',
  summary: 'Summary',
  skills: 'Skills',
  experience: 'Experience',
  education: 'Education',
  projects: 'Projects',
  certifications: 'Certifications',
};

const SECTION_GUIDANCE: Record<SectionType, { tip: string; helper?: string }> = {
  contact: {
    tip: 'Use the name and contact info you want recruiters to see.',
    helper: 'Include at least one way to contact you (email or phone).',
  },
  summary: {
    tip: '2-3 sentences focused on role, scope, and results.',
    helper: 'Mention your target role, years of experience, and a clear outcome.',
  },
  skills: {
    tip: 'List 6-12 ATS-friendly skills aligned to the role.',
    helper: 'Separate skills with commas. Avoid soft skills unless requested.',
  },
  experience: {
    tip: 'Each bullet should be one line with action + impact.',
    helper: 'Aim for 2-5 bullets per role and include numbers when possible.',
  },
  education: {
    tip: 'Include degree, institution, and dates.',
    helper: 'Add honors, coursework, or certifications if relevant.',
  },
  projects: {
    tip: 'Great for early-career or role-specific work.',
    helper: 'Highlight outcomes, tech stack, and measurable impact.',
  },
  certifications: {
    tip: 'Add current, relevant certifications.',
    helper: 'Include issuer and date for credibility.',
  },
};

export default function ResumeEditor() {
  const searchParams = useSearchParams();
  const idParam = searchParams.get('id') || '';
  const templateParam = searchParams.get('template') || '';
  const [resumeId, setResumeId] = useState(idParam);
  const resume = useResumeStore((state) => state.resume as unknown as ResumeDraft);
  const setResumeStore = useResumeStore((state) => state.setResume);
  const resetResumeStore = useResumeStore((state) => state.resetResume);
  const setResume = (updater: ResumeDraft | ((prev: ResumeDraft) => ResumeDraft)) => {
    setResumeStore(updater as any);
  };
  const [sections, setSections] = useState<SectionState[]>(() => getDefaultSections());
  const [jdText, setJdText] = useState('');
  const [message, setMessage] = useState('');
  const [loadingUpload, setLoadingUpload] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>((templateParam as TemplateId) || 'classic');
  const [hoveredTemplate, setHoveredTemplate] = useState<TemplateId | ''>('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string>('');
  const [importNotes, setImportNotes] = useState('');
  const [importRoleLevel, setImportRoleLevel] = useState<'FRESHER' | 'MID' | 'SENIOR' | ''>('');
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewAccent, setPreviewAccent] = useState('#111');
  const [previewFont, setPreviewFont] = useState('template');
  const [previewSpacing, setPreviewSpacing] = useState<'compact' | 'normal' | 'airy'>('normal');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportIssues, setExportIssues] = useState<string[]>([]);
  const [exportApproved, setExportApproved] = useState(false);
  const [exportSummary, setExportSummary] = useState<string>('');
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    resetResumeStore();
    setImportNotes('');
    setImportRoleLevel('');
  }, [idParam, templateParam, resetResumeStore]);

  useEffect(() => {
    if (templateParam) {
      setSelectedTemplate(templateParam as TemplateId);
    }
  }, [templateParam]);

  useEffect(() => {
    if (!getAccessToken()) {
      setMessage('Please sign in to edit resumes.');
      return;
    }
    if (idParam) {
      api.getResume(idParam)
        .then((r) => {
          setResumeId(r.id);
          setResume(resumeFromApi(r));
        })
        .catch((err) => setMessage(err instanceof Error ? err.message : 'Failed to load resume'));
      return;
    }
    if (templateParam) {
      const preset = getTemplatePreset(templateParam);
      if (preset) {
        setResume((prev) => ({
          ...prev,
          title: preset.title,
          summary: preset.summary,
          skills: preset.skills,
        }));
      }
    }
  }, [idParam, templateParam]);

  const validation = useMemo(() => validateResumeDraft(resume, sections), [resume, sections]);
  const summaryCharCount = resume.summary.trim().length;
  const skillsCount = resume.skills.length;
  const experienceBullets = resume.experience.flatMap((e) => e.highlights).filter(Boolean);
  const longExperienceBullets = experienceBullets.filter((b) => wordCount(b) > 28);
  const hasExperienceMetrics = experienceBullets.some((b) => /\d/.test(b));
  const missingContact = resume.contact && !resume.contact.email && !resume.contact.phone;
  const experienceCount = resume.experience.filter(isMeaningfulExperience).length;
  const detectedRoleLevel = useMemo(
    () => detectExperienceLevelFromDraft(resume),
    [resume],
  );
  const guidance = useMemo(() => buildGuidance({
    summaryCharCount,
    skillsCount,
    hasExperienceMetrics,
    longBulletCount: longExperienceBullets.length,
    missingContact: Boolean(missingContact),
    experienceCount,
    roleLevel: detectedRoleLevel || 'MID',
  }), [summaryCharCount, skillsCount, hasExperienceMetrics, longExperienceBullets.length, missingContact, experienceCount, detectedRoleLevel]);

  const previewResume = useMemo(() => ({
    title: resume.title || 'Your Name',
    contact: resume.contact,
    summary: resume.summary || 'Add a concise professional summary.',
    skills: resume.skills.length ? resume.skills : ['Skill 1', 'Skill 2', 'Skill 3'],
    experience: resume.experience.length ? resume.experience : [structuredClone(emptyExperience)],
    education: resume.education.length ? resume.education : [structuredClone(emptyEducation)],
    projects: resume.projects,
    certifications: resume.certifications,
  }), [resume]);

  const activeTemplate = hoveredTemplate || selectedTemplate;
  const previewStyle = { '--page-height': `${Math.round(1120 * previewZoom)}px` } as CSSProperties;

  useEffect(() => {
    if (!dirtyRef.current) return;
    if (!getAccessToken()) return;
    if (!validation.canAutoSave) {
      setStatus('idle');
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDraft(true).catch(() => undefined);
    }, 1200);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [resume, sections, validation.canAutoSave]);

  useEffect(() => {
    if (!resumeId || !getAccessToken()) return;
    const timer = setTimeout(() => {
      api.recomputeResume(resumeId)
        .then((result) => setImportRoleLevel(result.roleLevel))
        .catch((err) => {
          if (process.env.NODE_ENV !== 'production') {
            console.error('[recomputeResume] failed', err);
          }
        });
    }, 900);
    return () => clearTimeout(timer);
  }, [resume, resumeId]);

  async function saveDraft(isAuto = false) {
    setStatus('saving');
    setMessage('');
    const payload = buildPayload(resume, sections);
    try {
      let result: Resume;
      if (resumeId) {
        result = await api.updateResume(resumeId, payload);
      } else {
        result = await api.createResume(payload);
        setResumeId(result.id);
      }
      setStatus('saved');
      dirtyRef.current = false;
      setLastSavedAt(new Date().toLocaleTimeString());
      if (!isAuto) setMessage('Saved');
      return result;
    } catch (err: unknown) {
      setStatus('error');
      if (!isAuto) setMessage(err instanceof Error ? err.message : 'Save failed');
      throw err;
    }
  }

  function markDirty() {
    dirtyRef.current = true;
    if (status !== 'saving') setStatus('idle');
  }

  async function score() {
    if (!resumeId) {
      setMessage('Save first to score');
      return;
    }
    try {
      const result = await api.atsScore(resumeId, jdText);
      const summaryText = [
        `Role: ${result.roleLevel}.`,
        `ATS Score: ${result.roleAdjustedScore}.`,
        result.rejectionReasons.length ? `Rejections: ${result.rejectionReasons.slice(0, 2).join(' ')}` : '',
        result.missingKeywords.length ? `Missing: ${result.missingKeywords.slice(0, 6).join(', ')}.` : 'No major missing keywords.',
        result.improvementSuggestions.length ? `Suggestions: ${result.improvementSuggestions.slice(0, 3).join(' ')}` : '',
      ].filter(Boolean).join(' ');
      setMessage(summaryText);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Scoring failed');
    }
  }

  async function parseJd() {
    if (!jdText.trim()) {
      setMessage('Paste a job description first.');
      return;
    }
    try {
      const result = await api.parseJd(jdText);
      setMessage(`JD skills: ${result.skills.slice(0, 8).join(', ')}.`);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'JD parsing failed');
    }
  }

  async function critique() {
    const resumeText = [resume.summary, resume.skills.join(' '), JSON.stringify(resume.experience), JSON.stringify(resume.education)].join(' ');
    try {
      const result = await api.critique(resumeText, jdText || undefined);
      const text = `Highlights: ${result.highlights.slice(0, 3).join(' ')} | Weaknesses: ${result.weaknesses.slice(0, 3).join(' ')}`;
      setMessage(text);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Critique failed');
    }
  }

  async function exportPdf() {
    if (!resumeId) {
      setMessage('Save first to export.');
      return;
    }
    setExportOpen(true);
    setExportApproved(false);
    setExportIssues([]);
    setExportSummary('');
    setExportLoading(true);
    try {
      const ats = await api.atsScore(resumeId, jdText || undefined);
      const issues = [
        ...getSectionIssues(validation),
        ...ats.rejectionReasons,
      ];
      setExportIssues(issues);
      setExportSummary(`ATS score: ${ats.roleAdjustedScore}. ${ats.rejectionReasons.length ? 'Resolve blockers before export.' : 'Good to export.'}`);
    } catch (err: unknown) {
      setExportIssues(getSectionIssues(validation));
      setExportSummary(err instanceof Error ? err.message : 'Could not run ATS check. You can still export.');
    } finally {
      setExportLoading(false);
    }
  }

  async function onUpload(file?: File) {
    if (!file) return;
    setLoadingUpload(true);
    setMessage('');
    try {
      if (resumeId) {
        const result = await api.ingestResume(resumeId, file);
        setResume(() => resumeFromApi(result.resume));
        setImportNotes(result.mapped.unmappedText || '');
        setImportRoleLevel(result.mapped.roleLevel || '');
        setMessage(`Resume ingested. Detected level: ${formatRoleLevel(result.mapped.roleLevel || 'MID')}.`);
      } else {
        const uploadResult: UploadResumeResponse = await api.uploadResume(file);
        const parsed = normalizeUploadParsed(uploadResult);
        setImportNotes(parsed.unmappedText || uploadResult.text || '');
        setImportRoleLevel(parsed.roleLevel || '');
        setResume((prev) => mergeImportedResume(prev, parsed));
        const levelNote = parsed.roleLevel ? ` Detected level: ${formatRoleLevel(parsed.roleLevel)}.` : '';
        setMessage(`Resume imported. Review and edit the fields.${levelNote}`);
      }
      markDirty();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoadingUpload(false);
    }
  }

  function updateSectionOrder(index: number, direction: -1 | 1) {
    setSections((prev) => {
      const enabled = prev.filter((s) => s.enabled);
      const target = enabled[index];
      const swapIndex = index + direction;
      if (!enabled[swapIndex]) return prev;
      const targetIndex = prev.findIndex((s) => s.id === target.id);
      const swapTarget = enabled[swapIndex];
      const swapIndexAll = prev.findIndex((s) => s.id === swapTarget.id);
      const next = [...prev];
      next[targetIndex] = swapTarget;
      next[swapIndexAll] = target;
      return next;
    });
    markDirty();
  }

  function disableSection(type: SectionType) {
    setSections((prev) => prev.map((s) => (s.type === type ? { ...s, enabled: false } : s)));
    markDirty();
  }

  function enableSection(type: SectionType) {
    setSections((prev) => prev.map((s) => (s.type === type ? { ...s, enabled: true } : s)));
    markDirty();
  }

  const enabledSections = sections.filter((s) => s.enabled);
  const hiddenSections = sections.filter((s) => !s.enabled && !s.required);
  const completedSectionCount = enabledSections.filter((s) => validation.sections[s.type].level === 'good').length;
  const completionPercent = enabledSections.length ? Math.round((completedSectionCount / enabledSections.length) * 100) : 0;

  return (
    <main className="grid">
      <section className="card col-7">
        <div className="editor-header">
          <div>
            <h2>Resume Editor</h2>
            <p className="small">{getStatusText(status, lastSavedAt, validation.canAutoSave)}</p>
          </div>
          <div className="editor-actions">
            <span className="pill">{formatRoleLevel(detectedRoleLevel)}</span>
            <StatusPill status={status} canAutoSave={validation.canAutoSave} lastSavedAt={lastSavedAt} />
            <label className="btn secondary" style={{ cursor: 'pointer' }}>
              Upload Resume
              <input
                type="file"
                accept=".pdf,.docx,.txt"
                onChange={(e) => onUpload(e.target.files?.[0])}
                disabled={loadingUpload}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>
        {loadingUpload && <p className="small">Importing...</p>}

        {importRoleLevel && (
          <div className="card" style={{ marginTop: 16, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Detected experience level</h3>
            <p className="small">Upload detection returned {formatRoleLevel(importRoleLevel)}. Current editor state is {formatRoleLevel(detectedRoleLevel)}.</p>
          </div>
        )}

        {importNotes && (
          <div className="card section-card" style={{ marginTop: 16, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>From Upload (Unsorted)</h3>
            <p className="small">Review this content and paste it into the right section.</p>
            <textarea
              className="input"
              style={{ minHeight: 120 }}
              value={importNotes}
              onChange={(e) => setImportNotes(e.target.value)}
            />
            <div className="field-meta">
              <button
                className="btn secondary"
                onClick={() => {
                  if (!importNotes.trim()) return;
                  setResume((prev) => ({
                    ...prev,
                    summary: prev.summary ? `${prev.summary} ${importNotes}`.trim() : importNotes.trim(),
                  }));
                  setImportNotes('');
                  markDirty();
                }}
              >
                Append to summary
              </button>
              <button className="btn secondary" onClick={() => setImportNotes('')}>Clear</button>
            </div>
          </div>
        )}

        <div className="section-card" style={{ marginTop: 16 }}>
          <label className="label">Resume title</label>
          <input
            className="input"
            placeholder="e.g., Senior Product Designer Resume"
            value={resume.title}
            onChange={(e) => {
              setResume((prev) => ({ ...prev, title: e.target.value }));
              markDirty();
            }}
          />
          <p className="small" style={{ marginTop: 8 }}>This is for your dashboard. It does not appear on the resume.</p>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="completion-header">
            <strong>Section completion</strong>
            <span className="small">{completedSectionCount}/{enabledSections.length} complete ({completionPercent}%)</span>
          </div>
          <div className="completion-track">
            <div className="completion-fill" style={{ width: `${completionPercent}%` }} />
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="guidance-header">
            <div>
              <h3 style={{ margin: 0 }}>ATS Guidance</h3>
              <p className="small">Live feedback to keep your resume ATS-safe and high-impact.</p>
            </div>
            <span className={`pill ${guidance.status}`}>{guidance.statusLabel}</span>
          </div>
          <div className="guidance-grid">
            {guidance.items.map((item, idx) => (
              <div key={`guidance-${idx}`} className={`guidance-item ${item.level}`}>
                <strong>{item.title}</strong>
                <p className="small">{item.message}</p>
              </div>
            ))}
          </div>
        </div>

        {enabledSections.map((section, idx) => {
          const feedback = validation.sections[section.type];
          return (
            <div key={section.id} className="card section-card" style={{ marginTop: 16, padding: 16 }}>
              <div className="section-header">
                <div>
                  <h3 style={{ margin: 0 }}>{SECTION_LABELS[section.type]}</h3>
                  <div className="section-sub">
                    <SectionBadge level={feedback.level} text={feedback.text} />
                    <span className="small">{SECTION_GUIDANCE[section.type].tip}</span>
                  </div>
                </div>
                <div className="section-actions">
                  <button className="btn secondary" onClick={() => updateSectionOrder(idx, -1)} disabled={idx === 0} aria-label="Move section up">Up</button>
                  <button className="btn secondary" onClick={() => updateSectionOrder(idx, 1)} disabled={idx === enabledSections.length - 1} aria-label="Move section down">Down</button>
                  {!section.required && (
                    <button className="btn secondary" onClick={() => disableSection(section.type)}>Remove</button>
                  )}
                </div>
              </div>
              {section.type === 'contact' && (
                <div style={{ marginTop: 12 }}>
                  <label className="label">Full name</label>
                  <input
                    className="input"
                    value={resume.contact.fullName}
                    onChange={(e) => {
                      setResume((prev) => ({ ...prev, contact: { ...prev.contact, fullName: e.target.value } }));
                      markDirty();
                    }}
                  />
                  {!resume.contact.fullName.trim() && (
                    <p className="hint error">Required to enable autosave.</p>
                  )}
                  <div className="grid" style={{ marginTop: 10 }}>
                    <div className="col-6">
                      <label className="label">Email</label>
                      <input
                        className="input"
                        value={resume.contact.email || ''}
                        onChange={(e) => {
                          setResume((prev) => ({ ...prev, contact: { ...prev.contact, email: e.target.value } }));
                          markDirty();
                        }}
                      />
                    </div>
                    <div className="col-6">
                      <label className="label">Phone</label>
                      <input
                        className="input"
                        value={resume.contact.phone || ''}
                        onChange={(e) => {
                          setResume((prev) => ({ ...prev, contact: { ...prev.contact, phone: e.target.value } }));
                          markDirty();
                        }}
                      />
                    </div>
                  </div>
                  <p className="hint" style={{ marginTop: 8 }}>{SECTION_GUIDANCE.contact.helper}</p>
                  {missingContact && <p className="hint warn">ATS risk: Add at least one direct contact method.</p>}
                  <div className="grid" style={{ marginTop: 10 }}>
                    <div className="col-6">
                      <label className="label">Location</label>
                      <input
                        className="input"
                        value={resume.contact.location || ''}
                        onChange={(e) => {
                          setResume((prev) => ({ ...prev, contact: { ...prev.contact, location: e.target.value } }));
                          markDirty();
                        }}
                      />
                    </div>
                    <div className="col-6">
                      <label className="label">Links (comma separated)</label>
                      <input
                        className="input"
                        value={(resume.contact.links || []).join(', ')}
                        onChange={(e) => {
                          const links = e.target.value.split(',').map((l) => l.trim()).filter(Boolean);
                          setResume((prev) => ({ ...prev, contact: { ...prev.contact, links } }));
                          markDirty();
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {section.type === 'summary' && (
                <div style={{ marginTop: 12 }}>
                  <label className="label">Summary</label>
                  <textarea
                    className="input"
                    style={{ minHeight: 120 }}
                    value={resume.summary}
                    onChange={(e) => {
                      setResume((prev) => ({ ...prev, summary: e.target.value }));
                      markDirty();
                    }}
                  />
                  <div className="field-meta">
                    <span className={summaryCharCount >= 40 ? 'hint good' : 'hint warn'}>
                      {summaryCharCount} characters
                    </span>
                    <span className="hint">{SECTION_GUIDANCE.summary.helper}</span>
                  </div>
                  {detectedRoleLevel === 'SENIOR' && (
                    <p className="hint">Senior tip: call out scope, team size, and strategic impact.</p>
                  )}
                  {detectedRoleLevel === 'FRESHER' && (
                    <p className="hint">Entry tip: highlight transferable skills and project outcomes.</p>
                  )}
                </div>
              )}

              {section.type === 'skills' && (
                <div style={{ marginTop: 12 }}>
                  <label className="label">Skills (comma separated)</label>
                  <input
                    className="input"
                    value={resume.skills.join(', ')}
                    onChange={(e) => {
                      const skills = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                      setResume((prev) => ({ ...prev, skills }));
                      markDirty();
                    }}
                  />
                  <div className="field-meta">
                    <span className={skillsCount >= 6 ? 'hint good' : skillsCount >= 3 ? 'hint warn' : 'hint error'}>
                      {skillsCount} skills
                    </span>
                    <span className="hint">{SECTION_GUIDANCE.skills.helper}</span>
                  </div>
                  {detectedRoleLevel === 'FRESHER' && (
                    <p className="hint">Entry tip: include tools, languages, and coursework-relevant skills.</p>
                  )}
                </div>
              )}

              {section.type === 'experience' && (
                <div style={{ marginTop: 12 }}>
                  <div className="field-meta" style={{ marginBottom: 8 }}>
                    <span className={hasExperienceMetrics ? 'hint good' : 'hint warn'}>
                      {hasExperienceMetrics ? 'Metrics included' : 'Add numbers to show impact'}
                    </span>
                    <span className={longExperienceBullets.length ? 'hint warn' : 'hint good'}>
                      {longExperienceBullets.length ? `${longExperienceBullets.length} long bullets` : 'Bullets are concise'}
                    </span>
                  </div>
                  {detectedRoleLevel === 'SENIOR' && (
                    <p className="hint">Senior tip: emphasize leadership, org-wide impact, and strategic initiatives.</p>
                  )}
                  {detectedRoleLevel === 'FRESHER' && (
                    <p className="hint">Entry tip: 2-3 bullets per role are enough if results are clear.</p>
                  )}
                  {resume.experience.map((exp, expIdx) => (
                    <div key={`exp-${expIdx}`} className="card" style={{ padding: 12, marginBottom: 12 }}>
                      <label className="label">Company</label>
                      <input className="input" value={exp.company} onChange={(e) => {
                        const copy = [...resume.experience];
                        copy[expIdx] = { ...copy[expIdx], company: e.target.value };
                        setResume((prev) => ({ ...prev, experience: copy }));
                        markDirty();
                      }} />
                      <label className="label" style={{ marginTop: 8 }}>Role</label>
                      <input className="input" value={exp.role} onChange={(e) => {
                        const copy = [...resume.experience];
                        copy[expIdx] = { ...copy[expIdx], role: e.target.value };
                        setResume((prev) => ({ ...prev, experience: copy }));
                        markDirty();
                      }} />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <input className="input" placeholder="Start (YYYY-MM)" value={exp.startDate} onChange={(e) => {
                          const copy = [...resume.experience];
                          copy[expIdx] = { ...copy[expIdx], startDate: e.target.value };
                          setResume((prev) => ({ ...prev, experience: copy }));
                          markDirty();
                        }} />
                        <input className="input" placeholder="End (YYYY-MM)" value={exp.endDate} onChange={(e) => {
                          const copy = [...resume.experience];
                          copy[expIdx] = { ...copy[expIdx], endDate: e.target.value };
                          setResume((prev) => ({ ...prev, experience: copy }));
                          markDirty();
                        }} />
                      </div>
                      <label className="label" style={{ marginTop: 8 }}>Highlights (one per line)</label>
                      <textarea className="input" style={{ minHeight: 90 }} placeholder="Improved checkout conversion by 18% by redesigning the flow." value={exp.highlights.join('\n')} onChange={(e) => {
                        const copy = [...resume.experience];
                        copy[expIdx] = { ...copy[expIdx], highlights: e.target.value.split('\n') };
                        setResume((prev) => ({ ...prev, experience: copy }));
                        markDirty();
                      }} />
                      <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => {
                        const copy = resume.experience.filter((_, i) => i !== expIdx);
                        setResume((prev) => ({ ...prev, experience: copy.length ? copy : [structuredClone(emptyExperience)] }));
                        markDirty();
                      }}>Remove</button>
                    </div>
                  ))}
                  <button className="btn" onClick={() => {
                    setResume((prev) => ({ ...prev, experience: [...prev.experience, structuredClone(emptyExperience)] }));
                    markDirty();
                  }}>Add experience</button>
                </div>
              )}

              {section.type === 'education' && (
                <div style={{ marginTop: 12 }}>
                  <div className="field-meta" style={{ marginBottom: 8 }}>
                    <span className={resume.education.length ? 'hint good' : 'hint error'}>
                      {resume.education.length} entries
                    </span>
                    <span className="hint">{SECTION_GUIDANCE.education.helper}</span>
                  </div>
                  {resume.education.map((edu, eduIdx) => (
                    <div key={`edu-${eduIdx}`} className="card" style={{ padding: 12, marginBottom: 12 }}>
                      <label className="label">Institution</label>
                      <input className="input" value={edu.institution} onChange={(e) => {
                        const copy = [...resume.education];
                        copy[eduIdx] = { ...copy[eduIdx], institution: e.target.value };
                        setResume((prev) => ({ ...prev, education: copy }));
                        markDirty();
                      }} />
                      <label className="label" style={{ marginTop: 8 }}>Degree</label>
                      <input className="input" value={edu.degree} onChange={(e) => {
                        const copy = [...resume.education];
                        copy[eduIdx] = { ...copy[eduIdx], degree: e.target.value };
                        setResume((prev) => ({ ...prev, education: copy }));
                        markDirty();
                      }} />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <input className="input" placeholder="Start (YYYY-MM)" value={edu.startDate} onChange={(e) => {
                          const copy = [...resume.education];
                          copy[eduIdx] = { ...copy[eduIdx], startDate: e.target.value };
                          setResume((prev) => ({ ...prev, education: copy }));
                          markDirty();
                        }} />
                        <input className="input" placeholder="End (YYYY-MM)" value={edu.endDate} onChange={(e) => {
                          const copy = [...resume.education];
                          copy[eduIdx] = { ...copy[eduIdx], endDate: e.target.value };
                          setResume((prev) => ({ ...prev, education: copy }));
                          markDirty();
                        }} />
                      </div>
                      <label className="label" style={{ marginTop: 8 }}>Details (one per line)</label>
                      <textarea className="input" style={{ minHeight: 80 }} placeholder="Dean's List, GPA 3.8, Relevant coursework" value={edu.details.join('\n')} onChange={(e) => {
                        const copy = [...resume.education];
                        copy[eduIdx] = { ...copy[eduIdx], details: e.target.value.split('\n') };
                        setResume((prev) => ({ ...prev, education: copy }));
                        markDirty();
                      }} />
                      <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => {
                        const copy = resume.education.filter((_, i) => i !== eduIdx);
                        setResume((prev) => ({ ...prev, education: copy.length ? copy : [structuredClone(emptyEducation)] }));
                        markDirty();
                      }}>Remove</button>
                    </div>
                  ))}
                  <button className="btn" onClick={() => {
                    setResume((prev) => ({ ...prev, education: [...prev.education, structuredClone(emptyEducation)] }));
                    markDirty();
                  }}>Add education</button>
                </div>
              )}
              {section.type === 'projects' && (
                <div style={{ marginTop: 12 }}>
                  <div className="field-meta" style={{ marginBottom: 8 }}>
                    <span className={resume.projects.length ? 'hint good' : 'hint warn'}>
                      {resume.projects.length} projects
                    </span>
                    <span className="hint">{SECTION_GUIDANCE.projects.helper}</span>
                  </div>
                  {resume.projects.map((proj, projIdx) => (
                    <div key={`proj-${projIdx}`} className="card" style={{ padding: 12, marginBottom: 12 }}>
                      <label className="label">Project name</label>
                      <input className="input" value={proj.name} onChange={(e) => {
                        const copy = [...resume.projects];
                        copy[projIdx] = { ...copy[projIdx], name: e.target.value };
                        setResume((prev) => ({ ...prev, projects: copy }));
                        markDirty();
                      }} />
                      <label className="label" style={{ marginTop: 8 }}>Role (optional)</label>
                      <input className="input" value={proj.role || ''} onChange={(e) => {
                        const copy = [...resume.projects];
                        copy[projIdx] = { ...copy[projIdx], role: e.target.value };
                        setResume((prev) => ({ ...prev, projects: copy }));
                        markDirty();
                      }} />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <input className="input" placeholder="Start (YYYY-MM)" value={proj.startDate || ''} onChange={(e) => {
                          const copy = [...resume.projects];
                          copy[projIdx] = { ...copy[projIdx], startDate: e.target.value };
                          setResume((prev) => ({ ...prev, projects: copy }));
                          markDirty();
                        }} />
                        <input className="input" placeholder="End (YYYY-MM)" value={proj.endDate || ''} onChange={(e) => {
                          const copy = [...resume.projects];
                          copy[projIdx] = { ...copy[projIdx], endDate: e.target.value };
                          setResume((prev) => ({ ...prev, projects: copy }));
                          markDirty();
                        }} />
                      </div>
                      <label className="label" style={{ marginTop: 8 }}>Highlights (one per line)</label>
                      <textarea className="input" style={{ minHeight: 80 }} placeholder="Built a scheduling app used by 200+ users" value={proj.highlights.join('\n')} onChange={(e) => {
                        const copy = [...resume.projects];
                        copy[projIdx] = { ...copy[projIdx], highlights: e.target.value.split('\n') };
                        setResume((prev) => ({ ...prev, projects: copy }));
                        markDirty();
                      }} />
                      <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => {
                        const copy = resume.projects.filter((_, i) => i !== projIdx);
                        setResume((prev) => ({ ...prev, projects: copy.length ? copy : [structuredClone(emptyProject)] }));
                        markDirty();
                      }}>Remove</button>
                    </div>
                  ))}
                  <button className="btn" onClick={() => {
                    setResume((prev) => ({ ...prev, projects: [...prev.projects, structuredClone(emptyProject)] }));
                    markDirty();
                  }}>Add project</button>
                </div>
              )}

              {section.type === 'certifications' && (
                <div style={{ marginTop: 12 }}>
                  <div className="field-meta" style={{ marginBottom: 8 }}>
                    <span className={resume.certifications.length ? 'hint good' : 'hint warn'}>
                      {resume.certifications.length} certifications
                    </span>
                    <span className="hint">{SECTION_GUIDANCE.certifications.helper}</span>
                  </div>
                  {resume.certifications.map((cert, certIdx) => (
                    <div key={`cert-${certIdx}`} className="card" style={{ padding: 12, marginBottom: 12 }}>
                      <label className="label">Certification</label>
                      <input className="input" value={cert.name} onChange={(e) => {
                        const copy = [...resume.certifications];
                        copy[certIdx] = { ...copy[certIdx], name: e.target.value };
                        setResume((prev) => ({ ...prev, certifications: copy }));
                        markDirty();
                      }} />
                      <div className="grid" style={{ marginTop: 8 }}>
                        <div className="col-6">
                          <label className="label">Issuer</label>
                          <input className="input" value={cert.issuer || ''} onChange={(e) => {
                            const copy = [...resume.certifications];
                            copy[certIdx] = { ...copy[certIdx], issuer: e.target.value };
                            setResume((prev) => ({ ...prev, certifications: copy }));
                            markDirty();
                          }} />
                        </div>
                        <div className="col-6">
                          <label className="label">Date</label>
                          <input className="input" value={cert.date || ''} onChange={(e) => {
                            const copy = [...resume.certifications];
                            copy[certIdx] = { ...copy[certIdx], date: e.target.value };
                            setResume((prev) => ({ ...prev, certifications: copy }));
                            markDirty();
                          }} />
                        </div>
                      </div>
                      <label className="label" style={{ marginTop: 8 }}>Details (one per line)</label>
                      <textarea className="input" style={{ minHeight: 80 }} placeholder="Specialization, score, renewal" value={(cert.details || []).join('\n')} onChange={(e) => {
                        const copy = [...resume.certifications];
                        copy[certIdx] = { ...copy[certIdx], details: e.target.value.split('\n') };
                        setResume((prev) => ({ ...prev, certifications: copy }));
                        markDirty();
                      }} />
                      <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => {
                        const copy = resume.certifications.filter((_, i) => i !== certIdx);
                        setResume((prev) => ({ ...prev, certifications: copy.length ? copy : [structuredClone(emptyCertification)] }));
                        markDirty();
                      }}>Remove</button>
                    </div>
                  ))}
                  <button className="btn" onClick={() => {
                    setResume((prev) => ({ ...prev, certifications: [...prev.certifications, structuredClone(emptyCertification)] }));
                    markDirty();
                  }}>Add certification</button>
                </div>
              )}
            </div>
          );
        })}

        {hiddenSections.length > 0 && (
          <div className="card" style={{ marginTop: 16, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Add section</h3>
            <p className="small">Optional sections are hidden until you add them.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {hiddenSections.map((section) => (
                <button key={section.id} className="btn secondary" onClick={() => enableSection(section.type)}>
                  Add {SECTION_LABELS[section.type]}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="label" style={{ marginTop: 16 }}>Job Description</label>
        <textarea className="input" style={{ minHeight: 120 }} value={jdText} onChange={(e) => setJdText(e.target.value)} />

        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => saveDraft(false)}>Save</button>
          <button className="btn secondary" onClick={score}>ATS Score</button>
          <button className="btn secondary" onClick={exportPdf}>Export</button>
          <button className="btn secondary" onClick={parseJd}>Parse JD</button>
          <button className="btn secondary" onClick={critique}>AI Critique</button>
        </div>
        {message && (
          <div className="message-banner" style={{ marginTop: 12 }}>
            <p className="small">{message}</p>
          </div>
        )}
      </section>
      <section className="card col-5 preview-pane">
        <h3>Template Gallery</h3>
        <p className="small">Hover to preview with your data. Click to apply instantly.</p>
        <div className="template-grid">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className={`template-card ${template.id === selectedTemplate ? 'active' : ''}`}
              onMouseEnter={() => setHoveredTemplate(template.id)}
              onMouseLeave={() => setHoveredTemplate('')}
              onFocus={() => setHoveredTemplate(template.id)}
              onBlur={() => setHoveredTemplate('')}
              onClick={() => setSelectedTemplate(template.id)}
            >
              <div className="template-card__preview">
                <TemplatePreview
                  templateId={template.id}
                  resume={previewResume}
                  compact
                  accentOverride={previewAccent}
                  fontOverride={previewFont}
                  spacing={previewSpacing}
                />
              </div>
              <div className="template-card__meta">
                <div>
                  <strong>{template.name}</strong>
                  <div className="small">{template.description}</div>
                </div>
                <span className="pill">{template.id === selectedTemplate ? 'Applied' : 'Preview'}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="card template-live">
          <div className="template-live__header">
            <div>
              <h4 style={{ margin: 0 }}>Live Preview</h4>
              <p className="small">Now viewing {templates.find((t) => t.id === activeTemplate)?.name}</p>
            </div>
            <span className="pill">{activeTemplate === selectedTemplate ? 'Applied' : 'Previewing'}</span>
          </div>
          <div className="preview-controls">
            <div className="control">
              <label className="label">Zoom</label>
              <div className="control-row">
                <button className="btn secondary" onClick={() => setPreviewZoom((z) => Math.max(0.7, Number((z - 0.1).toFixed(2))))}>-</button>
                <input
                  className="range"
                  type="range"
                  min="0.7"
                  max="1.3"
                  step="0.05"
                  value={previewZoom}
                  onChange={(e) => setPreviewZoom(Number(e.target.value))}
                />
                <button className="btn secondary" onClick={() => setPreviewZoom((z) => Math.min(1.3, Number((z + 0.1).toFixed(2))))}>+</button>
                <span className="small">{Math.round(previewZoom * 100)}%</span>
              </div>
            </div>
            <div className="control">
              <label className="label">Theme color</label>
              <div className="control-row">
                {['#111', '#2b3a55', '#1f3a5f', '#2f7a5d', '#7a3e20'].map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`swatch ${previewAccent === color ? 'active' : ''}`}
                    style={{ background: color }}
                    onClick={() => setPreviewAccent(color)}
                    aria-label={`Set theme color ${color}`}
                  />
                ))}
              </div>
            </div>
            <div className="control">
              <label className="label">Font</label>
              <select className="input" value={previewFont} onChange={(e) => setPreviewFont(e.target.value)}>
                <option value="template">Template default</option>
                <option value="IBM Plex Sans">IBM Plex Sans</option>
                <option value="Source Sans 3">Source Sans 3</option>
                <option value="Work Sans">Work Sans</option>
                <option value="Georgia">Georgia</option>
                <option value="Times New Roman">Times New Roman</option>
              </select>
            </div>
            <div className="control">
              <label className="label">Section spacing</label>
              <div className="control-row">
                {(['compact', 'normal', 'airy'] as const).map((spacing) => (
                  <button
                    key={spacing}
                    type="button"
                    className={`btn secondary ${previewSpacing === spacing ? 'active' : ''}`}
                    onClick={() => setPreviewSpacing(spacing)}
                  >
                    {spacing}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="template-live__canvas page-breaks" style={previewStyle}>
            <div className="preview-zoom" style={{ transform: `scale(${previewZoom})` }}>
              <TemplatePreview
                templateId={activeTemplate}
                resume={previewResume}
                accentOverride={previewAccent}
                fontOverride={previewFont}
                spacing={previewSpacing}
              />
            </div>
          </div>
        </div>
      </section>
      {exportOpen && (
        <div className="modal">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>Export & Finalize</h3>
                <p className="small">Review ATS checks and finalize your resume export.</p>
              </div>
              <button className="btn secondary" onClick={() => setExportOpen(false)}>Close</button>
            </div>
            {exportLoading ? (
              <p className="small">Running ATS checks...</p>
            ) : (
              <>
                {exportSummary && <p className="small">{exportSummary}</p>}
                {exportIssues.length ? (
                  <div className="export-issues">
                    <h4 style={{ margin: 0 }}>Export checks</h4>
                    <ul>
                      {exportIssues.map((issue, idx) => (
                        <li key={`issue-${idx}`} className="small">{issue}</li>
                      ))}
                    </ul>
                    <label className="export-ack">
                      <input
                        type="checkbox"
                        checked={exportApproved}
                        onChange={(e) => setExportApproved(e.target.checked)}
                      />
                      <span className="small">I understand the risks and want to export anyway.</span>
                    </label>
                  </div>
                ) : (
                  <div className="export-issues success">
                    <strong>Looks good.</strong>
                    <p className="small">No blockers detected. You're ready to export.</p>
                  </div>
                )}
                <div className="export-actions">
                  <button
                    className="btn"
                    disabled={exportIssues.length > 0 && !exportApproved}
                    onClick={async () => {
                      if (!resumeId) return;
                      try {
                        await api.downloadPdf(resumeId);
                        setMessage('PDF downloaded.');
                        setExportOpen(false);
                      } catch (err: unknown) {
                        setMessage(err instanceof Error ? err.message : 'PDF export failed');
                      }
                    }}
                  >
                    Download PDF
                  </button>
                  <button
                    className="btn secondary"
                    disabled={exportIssues.length > 0 && !exportApproved}
                    onClick={async () => {
                      if (!resumeId) return;
                      try {
                        const blob = await api.getPdfBlob(resumeId);
                        const url = window.URL.createObjectURL(blob);
                        window.open(url, '_blank');
                      } catch (err: unknown) {
                        setMessage(err instanceof Error ? err.message : 'Print preview failed');
                      }
                    }}
                  >
                    Print preview
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function StatusPill({ status, canAutoSave, lastSavedAt }: { status: 'idle' | 'saving' | 'saved' | 'error'; canAutoSave: boolean; lastSavedAt: string }) {
  const label = !canAutoSave
    ? 'Autosave off'
    : status === 'saving'
      ? 'Saving...'
      : status === 'saved'
        ? `Saved ${lastSavedAt ? `at ${lastSavedAt}` : ''}`.trim()
        : status === 'error'
          ? 'Save failed'
          : 'Autosave on';
  const state = !canAutoSave ? 'off' : status;
  return (
    <div className={`status-pill ${state}`}>
      {label}
    </div>
  );
}

function SectionBadge({ level, text }: { level: FeedbackLevel; text: string }) {
  const label = level === 'good' ? 'Good' : level === 'warn' ? 'Improve' : 'Required';
  return (
    <div className="badge-row">
      <span className={`badge ${level}`}>{label}</span>
      <span className="small">{text}</span>
    </div>
  );
}

function TemplatePreview({
  templateId,
  resume,
  compact = false,
  accentOverride,
  fontOverride,
  spacing = 'normal',
}: {
  templateId: TemplateId | string;
  resume: ResumeImportResult;
  compact?: boolean;
  accentOverride?: string;
  fontOverride?: string;
  spacing?: 'compact' | 'normal' | 'airy';
}) {
  const config = templates.find((t) => t.id === templateId) || templates[0];
  const accent = accentOverride || config.accent;
  const fontFamily = fontOverride && fontOverride !== 'template'
    ? `"${fontOverride}", ${config.fontFamily}`
    : config.fontFamily;
  const spacingClass = `spacing-${spacing}`;
  if (templateId === 'student') {
    return <StudentTemplate resume={resume} compact={compact} accent={accent} fontFamily={fontFamily} spacingClass={spacingClass} />;
  }
  if (templateId === 'senior') {
    return <SeniorTemplate resume={resume} compact={compact} accent={accent} fontFamily={fontFamily} spacingClass={spacingClass} />;
  }
  if (templateId === 'modern') {
    return <ModernTemplate resume={resume} compact={compact} accent={accent} fontFamily={fontFamily} spacingClass={spacingClass} />;
  }
  return <ClassicTemplate resume={resume} compact={compact} accent={accent} fontFamily={fontFamily} spacingClass={spacingClass} />;
}

function ClassicTemplate({ resume, compact, accent, fontFamily, spacingClass }: { resume: ResumeImportResult; compact: boolean; accent: string; fontFamily: string; spacingClass: string }) {
  return (
    <div className={`template-doc ${spacingClass} ${compact ? 'compact' : ''}`} style={{ fontFamily, color: '#111' }}>
      <div className="template-header" style={{ borderBottomColor: accent }}>
        <div>
          <strong className="template-title">{resume.title}</strong>
          <div className="template-meta">
            {resume.contact?.email || ''} {resume.contact?.phone || ''} {resume.contact?.location || ''}
          </div>
        </div>
        <div className="template-accent" style={{ background: accent }} />
      </div>
      <Section title="Summary" accent={accent} compact={compact}>
        <p className="small">{resume.summary}</p>
      </Section>
      <Section title="Skills" accent={accent} compact={compact}>
        <p className="small">{resume.skills.join(', ')}</p>
      </Section>
      <Section title="Experience" accent={accent} compact={compact}>
        {resume.experience.map((exp, idx) => (
          <div key={`classic-exp-${idx}`} className="template-item">
            <div className="template-item__head">
              <strong>{exp.role || 'Role'}</strong>
              <span>{exp.company || 'Company'}</span>
              <span className="template-dates">{exp.startDate} - {exp.endDate}</span>
            </div>
            <ul className="template-list">
              {exp.highlights.filter(Boolean).slice(0, compact ? 1 : 3).map((h, hIdx) => (
                <li key={`classic-exp-h-${hIdx}`} className="small">{h}</li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
      {resume.projects?.length ? (
        <Section title="Projects" accent={accent} compact={compact}>
          {resume.projects.map((proj, idx) => (
            <div key={`classic-proj-${idx}`} className="small">{proj.name}</div>
          ))}
        </Section>
      ) : null}
      {resume.certifications?.length ? (
        <Section title="Certifications" accent={accent} compact={compact}>
          {resume.certifications.map((cert, idx) => (
            <div key={`classic-cert-${idx}`} className="small">{cert.name}</div>
          ))}
        </Section>
      ) : null}
      <Section title="Education" accent={accent} compact={compact}>
        {resume.education.map((edu, idx) => (
          <div key={`classic-edu-${idx}`} className="small">
            {edu.degree || 'Degree'} - {edu.institution || 'Institution'}
          </div>
        ))}
      </Section>
    </div>
  );
}

function ModernTemplate({ resume, compact, accent, fontFamily, spacingClass }: { resume: ResumeImportResult; compact: boolean; accent: string; fontFamily: string; spacingClass: string }) {
  return (
    <div className={`template-doc modern ${spacingClass} ${compact ? 'compact' : ''}`} style={{ fontFamily, color: '#111' }}>
      <div className="template-header modern" style={{ borderBottomColor: accent }}>
        <div>
          <strong className="template-title">{resume.title}</strong>
          <div className="template-meta">
            {(resume.contact?.email || '')}{resume.contact?.email && resume.contact?.phone ? ' | ' : ''}
            {(resume.contact?.phone || '')}
          </div>
        </div>
        <div className="template-meta">{resume.contact?.location || ''}</div>
      </div>
      <div className="template-columns">
        <div>
          <Section title="Summary" accent={accent} compact={compact}>
            <p className="small">{resume.summary}</p>
          </Section>
          <Section title="Experience" accent={accent} compact={compact}>
            {resume.experience.map((exp, idx) => (
              <div key={`modern-exp-${idx}`} className="template-item">
                <div className="template-item__head">
                  <strong>{exp.role || 'Role'}</strong>
                  <span>{exp.company || 'Company'}</span>
                </div>
                <div className="template-dates">{exp.startDate} - {exp.endDate}</div>
                <ul className="template-list">
                  {exp.highlights.filter(Boolean).slice(0, compact ? 1 : 3).map((h, hIdx) => (
                    <li key={`modern-exp-h-${hIdx}`} className="small">{h}</li>
                  ))}
                </ul>
              </div>
            ))}
          </Section>
        </div>
        <div>
          <Section title="Skills" accent={accent} compact={compact}>
            <div className="template-skill-grid">
              {resume.skills.slice(0, compact ? 6 : 10).map((skill, idx) => (
                <span key={`modern-skill-${idx}`} className="template-chip">{skill}</span>
              ))}
            </div>
          </Section>
          <Section title="Education" accent={accent} compact={compact}>
            {resume.education.map((edu, idx) => (
              <div key={`modern-edu-${idx}`} className="small">
                <strong>{edu.degree || 'Degree'}</strong>
                <div>{edu.institution || 'Institution'}</div>
              </div>
            ))}
          </Section>
          {resume.projects?.length ? (
            <Section title="Projects" accent={accent} compact={compact}>
              {resume.projects.map((proj, idx) => (
                <div key={`modern-proj-${idx}`} className="small">{proj.name}</div>
              ))}
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StudentTemplate({ resume, compact, accent, fontFamily, spacingClass }: { resume: ResumeImportResult; compact: boolean; accent: string; fontFamily: string; spacingClass: string }) {
  return (
    <div className={`template-doc student ${spacingClass} ${compact ? 'compact' : ''}`} style={{ fontFamily, color: '#111' }}>
      <div className="template-header student" style={{ borderBottomColor: accent }}>
        <strong className="template-title">{resume.title}</strong>
        <div className="template-meta">{resume.contact?.email || ''} {resume.contact?.phone || ''}</div>
      </div>
      <Section title="Projects" accent={accent} compact={compact}>
        {resume.projects?.length ? resume.projects.map((proj, idx) => (
          <div key={`student-proj-${idx}`} className="template-item">
            <div className="template-item__head">
              <strong>{proj.name || 'Project'}</strong>
              <span className="template-dates">{proj.startDate || ''} {proj.endDate ? `- ${proj.endDate}` : ''}</span>
            </div>
            <ul className="template-list">
              {proj.highlights.filter(Boolean).slice(0, compact ? 1 : 3).map((h, hIdx) => (
                <li key={`student-proj-h-${hIdx}`} className="small">{h}</li>
              ))}
            </ul>
          </div>
        )) : <p className="small">Add projects to highlight your work.</p>}
      </Section>
      <Section title="Skills" accent={accent} compact={compact}>
        <p className="small">{resume.skills.join(', ')}</p>
      </Section>
      <Section title="Experience" accent={accent} compact={compact}>
        {resume.experience.map((exp, idx) => (
          <div key={`student-exp-${idx}`} className="template-item">
            <div className="template-item__head">
              <strong>{exp.role || 'Role'}</strong>
              <span>{exp.company || 'Company'}</span>
            </div>
            <ul className="template-list">
              {exp.highlights.filter(Boolean).slice(0, compact ? 1 : 2).map((h, hIdx) => (
                <li key={`student-exp-h-${hIdx}`} className="small">{h}</li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
      <Section title="Education" accent={accent} compact={compact}>
        {resume.education.map((edu, idx) => (
          <div key={`student-edu-${idx}`} className="small">
            {edu.degree || 'Degree'} - {edu.institution || 'Institution'}
          </div>
        ))}
      </Section>
    </div>
  );
}

function SeniorTemplate({ resume, compact, accent, fontFamily, spacingClass }: { resume: ResumeImportResult; compact: boolean; accent: string; fontFamily: string; spacingClass: string }) {
  return (
    <div className={`template-doc senior ${spacingClass} ${compact ? 'compact' : ''}`} style={{ fontFamily, color: '#111' }}>
      <div className="template-header senior" style={{ borderBottomColor: accent }}>
        <div>
          <strong className="template-title">{resume.title}</strong>
          <div className="template-meta">{resume.contact?.email || ''} {resume.contact?.phone || ''}</div>
        </div>
        <div className="template-meta">{resume.contact?.location || ''}</div>
      </div>
      <Section title="Executive Summary" accent={accent} compact={compact}>
        <p className="small">{resume.summary}</p>
      </Section>
      <Section title="Leadership & Impact" accent={accent} compact={compact}>
        {resume.experience.map((exp, idx) => (
          <div key={`senior-exp-${idx}`} className="template-item">
            <div className="template-item__head">
              <strong>{exp.role || 'Role'}</strong>
              <span>{exp.company || 'Company'}</span>
              <span className="template-dates">{exp.startDate} - {exp.endDate}</span>
            </div>
            <ul className="template-list">
              {exp.highlights.filter(Boolean).slice(0, compact ? 1 : 3).map((h, hIdx) => (
                <li key={`senior-exp-h-${hIdx}`} className="small">{h}</li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
      <div className="template-columns">
        <Section title="Core Skills" accent={accent} compact={compact}>
          <div className="template-skill-grid">
            {resume.skills.slice(0, compact ? 6 : 12).map((skill, idx) => (
              <span key={`senior-skill-${idx}`} className="template-chip">{skill}</span>
            ))}
          </div>
        </Section>
        <Section title="Education" accent={accent} compact={compact}>
          {resume.education.map((edu, idx) => (
            <div key={`senior-edu-${idx}`} className="small">
              {edu.degree || 'Degree'} - {edu.institution || 'Institution'}
            </div>
          ))}
        </Section>
      </div>
      {resume.certifications?.length ? (
        <Section title="Certifications" accent={accent} compact={compact}>
          {resume.certifications.map((cert, idx) => (
            <div key={`senior-cert-${idx}`} className="small">{cert.name}</div>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, accent, compact, children }: { title: string; accent: string; compact: boolean; children: ReactNode }) {
  return (
    <div className={`template-section ${compact ? 'compact' : ''}`}>
      <div className="template-section__title" style={{ color: accent }}>{title}</div>
      {children}
    </div>
  );
}
function getTemplatePreset(templateId: string) {
  if (templateId === 'student') {
    return {
      title: 'CS Student',
      summary: 'CS student with project experience in full-stack apps and ML.',
      skills: ['JavaScript', 'React', 'Node.js', 'SQL'],
    };
  }
  if (templateId === 'senior') {
    return {
      title: 'Senior Engineer',
      summary: 'Senior engineer leading cross-functional delivery and scaling systems.',
      skills: ['Leadership', 'System Design', 'Performance', 'Cloud'],
    };
  }
  if (templateId === 'modern') {
    return {
      title: 'Product Engineer',
      summary: 'Customer-focused engineer delivering polished, performant experiences.',
      skills: ['TypeScript', 'UX', 'APIs', 'Testing'],
    };
  }
  return {
    title: 'Software Engineer',
    summary: 'Impact-driven engineer with strong fundamentals in web and systems.',
    skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
  };
}

function getEmptyResume(): ResumeDraft {
  return {
    title: '',
    contact: { fullName: '' },
    summary: '',
    skills: [],
    experience: [structuredClone(emptyExperience)],
    education: [structuredClone(emptyEducation)],
    projects: [structuredClone(emptyProject)],
    certifications: [structuredClone(emptyCertification)],
  };
}

function getDefaultSections(): SectionState[] {
  return [
    { id: 'sec-contact', type: 'contact', enabled: true, required: true },
    { id: 'sec-summary', type: 'summary', enabled: true, required: true },
    { id: 'sec-skills', type: 'skills', enabled: true, required: true },
    { id: 'sec-experience', type: 'experience', enabled: true, required: true },
    { id: 'sec-education', type: 'education', enabled: true, required: true },
    { id: 'sec-projects', type: 'projects', enabled: false, required: false },
    { id: 'sec-certifications', type: 'certifications', enabled: false, required: false },
  ];
}

function buildPayload(resume: ResumeDraft, sections: SectionState[]) {
  const enabled = new Set(sections.filter((s) => s.enabled).map((s) => s.type));
  return {
    title: resume.title || resume.contact.fullName || 'Resume',
    contact: enabled.has('contact') ? resume.contact : undefined,
    summary: enabled.has('summary') ? resume.summary : '',
    skills: enabled.has('skills') ? resume.skills : [],
    experience: enabled.has('experience') ? resume.experience : [],
    education: enabled.has('education') ? resume.education : [],
    projects: enabled.has('projects') ? resume.projects : [],
    certifications: enabled.has('certifications') ? resume.certifications : [],
  };
}

function resumeFromApi(resume: Resume): ResumeDraft {
  return {
    title: resume.title || '',
    contact: resume.contact || { fullName: '' },
    summary: resume.summary || '',
    skills: resume.skills || [],
    experience: resume.experience?.length ? resume.experience : [structuredClone(emptyExperience)],
    education: resume.education?.length ? resume.education : [structuredClone(emptyEducation)],
    projects: resume.projects?.length ? resume.projects : [structuredClone(emptyProject)],
    certifications: resume.certifications?.length ? resume.certifications : [structuredClone(emptyCertification)],
  };
}

function validateResumeDraft(resume: ResumeDraft, sections: SectionState[]) {
  const enabled = new Set(sections.filter((s) => s.enabled).map((s) => s.type));
  const sectionFeedback: Record<SectionType, { level: FeedbackLevel; text: string }> = {
    contact: { level: 'good', text: 'Contact details are clear.' },
    summary: { level: 'good', text: '2-3 sentences focused on impact.' },
    skills: { level: 'good', text: 'Skills are concise and relevant.' },
    experience: { level: 'good', text: 'Bullets show action and impact.' },
    education: { level: 'good', text: 'Education is complete.' },
    projects: { level: 'good', text: 'Project outcomes are listed.' },
    certifications: { level: 'good', text: 'Certifications add credibility.' },
  };

  let canAutoSave = true;

  if (enabled.has('contact')) {
    if (!resume.contact.fullName || resume.contact.fullName.trim().length < 2) {
      sectionFeedback.contact = { level: 'error', text: 'Add your full name.' };
      canAutoSave = false;
    } else if (!resume.contact.email && !resume.contact.phone) {
      sectionFeedback.contact = { level: 'warn', text: 'Add an email or phone number.' };
    }
  }

  if (enabled.has('summary')) {
    if (!resume.summary || resume.summary.trim().length < 40) {
      sectionFeedback.summary = { level: 'warn', text: 'Add 2-3 sentences (40+ characters).' };
    }
  }

  if (enabled.has('skills')) {
    if (resume.skills.length < 3) {
      sectionFeedback.skills = { level: 'warn', text: 'Add at least 3 skills.' };
    }
  }

  if (enabled.has('experience')) {
    const bullets = resume.experience.flatMap((e) => e.highlights).filter(Boolean);
    const tooLong = bullets.filter((b) => wordCount(b) > 28);
    const hasMetric = bullets.some((b) => /\d/.test(b));
    if (resume.experience.length === 0 || !bullets.length) {
      sectionFeedback.experience = { level: 'error', text: 'Add a role with bullet highlights.' };
      canAutoSave = false;
    } else if (!hasMetric) {
      sectionFeedback.experience = { level: 'warn', text: 'Add measurable impact (numbers or percentages).' };
    } else if (tooLong.length) {
      sectionFeedback.experience = { level: 'warn', text: 'Trim bullets to 8-22 words.' };
    }
  }

  if (enabled.has('education')) {
    if (resume.education.length === 0) {
      sectionFeedback.education = { level: 'error', text: 'Add education details.' };
      canAutoSave = false;
    }
  }

  if (enabled.has('projects')) {
    if (!resume.projects.length || !resume.projects.some((p) => p.name.trim())) {
      sectionFeedback.projects = { level: 'warn', text: 'Add a project or remove this section.' };
    }
  }

  if (enabled.has('certifications')) {
    if (!resume.certifications.length || !resume.certifications.some((c) => c.name.trim())) {
      sectionFeedback.certifications = { level: 'warn', text: 'Add a certification or remove this section.' };
  }
  }

  return { canAutoSave, sections: sectionFeedback };
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function getStatusText(status: 'idle' | 'saving' | 'saved' | 'error', lastSavedAt: string, canAutoSave: boolean) {
  if (!canAutoSave) return 'Complete required sections to enable autosave.';
  if (status === 'saving') return 'Saving...';
  if (status === 'saved') return `Saved ${lastSavedAt ? `at ${lastSavedAt}` : ''}`.trim();
  if (status === 'error') return 'Save failed. Check required sections.';
  return 'Changes are saved automatically.';
}

function getSectionIssues(validation: { sections: Record<SectionType, { level: FeedbackLevel; text: string }> }) {
  return Object.values(validation.sections)
    .filter((section) => section.level === 'error')
    .map((section) => section.text);
}

function formatRoleLevel(level: 'FRESHER' | 'MID' | 'SENIOR') {
  if (level === 'FRESHER') return 'Fresher / Entry';
  if (level === 'SENIOR') return 'Senior';
  return 'Mid-level';
}

function isMeaningfulExperience(item: ExperienceItem) {
  return Boolean(
    item.company.trim() ||
    item.role.trim() ||
    item.startDate.trim() ||
    item.endDate.trim() ||
    item.highlights.some((h) => h.trim().length > 0),
  );
}

function parseDateToken(token: string, end = false) {
  if (!token) return null;
  if (/present|current|now/i.test(token)) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  const clean = token.trim().toLowerCase();
  const monthMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };
  const monthYear = clean.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{4})/i);
  if (monthYear) {
    const month = monthMap[monthYear[1].slice(0, 4)] || monthMap[monthYear[1].slice(0, 3)] || 1;
    return { year: Number(monthYear[2]), month };
  }
  const yearMonth = clean.match(/(\d{4})[-/](\d{1,2})/);
  if (yearMonth) {
    return { year: Number(yearMonth[1]), month: Math.max(1, Math.min(12, Number(yearMonth[2]))) };
  }
  const yearOnly = clean.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearOnly) {
    return { year: Number(yearOnly[1]), month: end ? 12 : 1 };
  }
  return null;
}

function dateSortValue(token: string, end = false) {
  const parsed = parseDateToken(token, end);
  if (!parsed) return 0;
  return parsed.year * 100 + parsed.month;
}

function estimateExperienceMonths(experience: ExperienceItem[]) {
  let total = 0;
  for (const item of experience) {
    const start = parseDateToken(item.startDate, false);
    if (!start) continue;
    const end = parseDateToken(item.endDate, true) || start;
    const startIndex = start.year * 12 + (start.month - 1);
    const endIndex = end.year * 12 + (end.month - 1);
    total += Math.max(1, endIndex - startIndex + 1);
  }
  return total;
}

function detectExperienceLevelFromDraft(resume: ResumeDraft) {
  const meaningful = resume.experience.filter(isMeaningfulExperience);
  const roleCount = meaningful.length;
  const distinctCompanies = new Set(
    meaningful.map((item) => item.company.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean),
  ).size;
  const rolesWithDate = meaningful.filter((item) => parseDateToken(item.startDate, false) && (parseDateToken(item.endDate, true) || /present/i.test(item.endDate))).length;
  const roleCompanyPatterns = meaningful.filter((item) => item.role.trim() && item.company.trim()).length;
  const totalMonths = estimateExperienceMonths(meaningful);
  const text = `${resume.summary} ${resume.skills.join(' ')} ${meaningful.map((item) => `${item.role} ${item.company}`).join(' ')}`.toLowerCase();

  if (roleCount === 0) return 'FRESHER';
  if (roleCount >= 2 || distinctCompanies >= 2 || totalMonths > 36) return 'SENIOR';
  if (roleCount >= 1 && roleCount <= 2 && rolesWithDate >= 1) return 'MID';
  if (roleCount <= 1 && totalMonths <= 12 && roleCompanyPatterns === 0) return 'FRESHER';
  if (/(intern|internship|student|fresher|entry level|entry-level|junior)/.test(text) && totalMonths < 24) return 'FRESHER';
  return 'MID';
}

function normalizeUploadParsed(result: UploadResumeResponse): ResumeImportResult {
  const parsed = result.parsed;
  if (!parsed || typeof parsed !== 'object') {
    return result;
  }
  return {
    ...result,
    ...parsed,
    unmappedText: parsed.unmappedText || result.unmappedText,
  };
}

function mergeImportedResume(current: ResumeDraft, parsed: ResumeImportResult): ResumeDraft {
  return {
    title: current.title.trim() ? current.title : (parsed.title || current.title),
    contact: mergeContact(current.contact, parsed.contact),
    summary: current.summary.trim() ? current.summary : (parsed.summary || current.summary),
    skills: mergeList(current.skills, parsed.skills || []),
    experience: mergeExperience(current.experience, parsed.experience || []),
    education: mergeEducation(current.education, parsed.education || []),
    projects: mergeProjects(current.projects, parsed.projects || []),
    certifications: mergeCertifications(current.certifications, parsed.certifications || []),
  };
}

function mergeContact(current: ContactInfo, incoming?: ContactInfo): ContactInfo {
  if (!incoming) return current;
  return {
    fullName: current.fullName || incoming.fullName || '',
    email: current.email || incoming.email,
    phone: current.phone || incoming.phone,
    location: current.location || incoming.location,
    links: mergeList(current.links || [], incoming.links || []),
  };
}

function mergeList(current: string[], incoming: string[]) {
  const merged = [...current, ...incoming].map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(merged));
}

function mergeExperience(current: ExperienceItem[], incoming: ExperienceItem[]) {
  const currentMeaningful = current.filter(isMeaningfulExperience);
  const incomingMeaningful = incoming.filter(isMeaningfulExperience);
  if (!incomingMeaningful.length) return current;
  if (!currentMeaningful.length) return sortExperience(incomingMeaningful);
  const map = new Map<string, ExperienceItem>();
  for (const item of currentMeaningful) {
    map.set(experienceKey(item), { ...item, highlights: item.highlights.filter(Boolean) });
  }
  for (const item of incomingMeaningful) {
    const key = experienceKey(item);
    if (!map.has(key)) {
      map.set(key, { ...item, highlights: item.highlights.filter(Boolean) });
      continue;
    }
    const merged = map.get(key)!;
    merged.highlights = mergeList(merged.highlights, item.highlights || []);
    merged.startDate = merged.startDate || item.startDate;
    merged.endDate = merged.endDate || item.endDate;
    merged.role = merged.role || item.role;
    merged.company = merged.company || item.company;
    map.set(key, merged);
  }
  return sortExperience(Array.from(map.values()));
}

function experienceKey(item: ExperienceItem) {
  const company = item.company.toLowerCase().replace(/[^a-z0-9]/g, '');
  const role = item.role.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${company}|${role}|${item.startDate}|${item.endDate}`;
}

function sortExperience(items: ExperienceItem[]) {
  const sorted = [...items];
  sorted.sort((a, b) => {
    const endA = dateSortValue(a.endDate || a.startDate, true);
    const endB = dateSortValue(b.endDate || b.startDate, true);
    if (endB !== endA) return endB - endA;
    return dateSortValue(b.startDate, false) - dateSortValue(a.startDate, false);
  });
  return sorted;
}

function mergeEducation(current: EducationItem[], incoming: EducationItem[]) {
  const currentMeaningful = current.filter((item) => item.institution.trim() || item.degree.trim() || item.details.some(Boolean));
  const incomingMeaningful = incoming.filter((item) => item.institution.trim() || item.degree.trim() || item.details.some(Boolean));
  if (!incomingMeaningful.length) return current;
  if (!currentMeaningful.length) return incomingMeaningful;
  const map = new Map<string, EducationItem>();
  for (const item of currentMeaningful) map.set(`${item.institution}|${item.degree}`, item);
  for (const item of incomingMeaningful) {
    const key = `${item.institution}|${item.degree}`;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function mergeProjects(current: ProjectItem[], incoming: ProjectItem[]) {
  const currentMeaningful = current.filter((item) => item.name.trim() || item.highlights.some(Boolean));
  const incomingMeaningful = incoming.filter((item) => item.name.trim() || item.highlights.some(Boolean));
  if (!incomingMeaningful.length) return current;
  if (!currentMeaningful.length) return incomingMeaningful;
  const map = new Map<string, ProjectItem>();
  for (const item of currentMeaningful) map.set(item.name.toLowerCase(), item);
  for (const item of incomingMeaningful) {
    const key = item.name.toLowerCase();
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function mergeCertifications(current: CertificationItem[], incoming: CertificationItem[]) {
  const currentMeaningful = current.filter((item) => item.name.trim());
  const incomingMeaningful = incoming.filter((item) => item.name.trim());
  if (!incomingMeaningful.length) return current;
  if (!currentMeaningful.length) return incomingMeaningful;
  const map = new Map<string, CertificationItem>();
  for (const item of currentMeaningful) map.set(item.name.toLowerCase(), item);
  for (const item of incomingMeaningful) {
    const key = item.name.toLowerCase();
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function buildGuidance(input: {
  summaryCharCount: number;
  skillsCount: number;
  hasExperienceMetrics: boolean;
  longBulletCount: number;
  missingContact: boolean;
  experienceCount: number;
  roleLevel: 'FRESHER' | 'MID' | 'SENIOR';
}) {
  const items: Array<{ level: 'good' | 'warn' | 'error'; title: string; message: string }> = [];
  if (input.missingContact) {
    items.push({ level: 'error', title: 'Contact Info', message: 'Add an email or phone number so recruiters can reach you.' });
  } else {
    items.push({ level: 'good', title: 'Contact Info', message: 'Clear contact details detected.' });
  }
  if (input.summaryCharCount < 40) {
    items.push({ level: 'warn', title: 'Summary', message: 'Add 2-3 sentences focused on role, scope, and impact.' });
  } else {
    items.push({ level: 'good', title: 'Summary', message: 'Summary length is ATS-friendly.' });
  }
  if (input.skillsCount < 3) {
    items.push({ level: 'error', title: 'Skills', message: 'Add at least 3 role-relevant skills.' });
  } else if (input.skillsCount < 6) {
    items.push({ level: 'warn', title: 'Skills', message: 'Add 6-12 skills aligned to the job description.' });
  } else {
    items.push({ level: 'good', title: 'Skills', message: 'Solid skill coverage for ATS parsing.' });
  }
  if (input.experienceCount < 1) {
    items.push({ level: 'error', title: 'Experience', message: 'Add at least one experience entry.' });
  } else if (!input.hasExperienceMetrics) {
    items.push({ level: 'warn', title: 'Impact', message: 'Add metrics to at least one bullet (%, $, time).' });
  } else {
    items.push({ level: 'good', title: 'Impact', message: 'Metrics detected in experience bullets.' });
  }
  if (input.longBulletCount > 0) {
    items.push({ level: 'warn', title: 'Bullet Length', message: 'Trim long bullets to 8-22 words for readability.' });
  } else {
    items.push({ level: 'good', title: 'Bullet Length', message: 'Bullet length is ATS-friendly.' });
  }

  if (input.roleLevel === 'FRESHER') {
    items.push({ level: 'warn', title: 'Entry Tip', message: 'Projects and coursework can strengthen early-career resumes.' });
  }
  if (input.roleLevel === 'SENIOR') {
    items.push({ level: 'warn', title: 'Leadership Tip', message: 'Highlight scope, team size, and cross-functional impact.' });
  }

  const errorCount = items.filter((i) => i.level === 'error').length;
  const warnCount = items.filter((i) => i.level === 'warn').length;
  const status = errorCount ? 'risk' : warnCount ? 'improve' : 'good';
  const statusLabel = errorCount ? 'Needs Attention' : warnCount ? 'Room to Improve' : 'Strong ATS Fit';
  return { items, status, statusLabel };
}
