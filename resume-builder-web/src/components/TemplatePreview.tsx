'use client';

import type { ReactNode } from 'react';
import type { EducationItem, ExperienceItem, ResumeImportResult } from 'resume-builder-shared';

export type TemplateVariant = 'classic' | 'modern' | 'student' | 'senior';

const templateList = [
  { id: 'classic', name: 'Classic ATS', description: 'Clean single-column layout.', accent: '#111', fontFamily: '"IBM Plex Sans", "Segoe UI", Arial, sans-serif', variant: 'classic' },
  { id: 'modern', name: 'Modern Professional', description: 'Sharper headings with ATS-safe spacing.', accent: '#2b3a55', fontFamily: '"Source Sans 3", "Segoe UI", Arial, sans-serif', variant: 'modern' },
  { id: 'student', name: 'Student Starter', description: 'Project-first layout for early careers.', accent: '#2f7a5d', fontFamily: '"Work Sans", "Segoe UI", Arial, sans-serif', variant: 'student' },
  { id: 'senior', name: 'Senior Impact', description: 'Experience and impact-driven layout.', accent: '#1f3a5f', fontFamily: '"Literata", "Times New Roman", serif', variant: 'senior' },
  { id: 'executive', name: 'Executive Focus', description: 'Leadership-first layout with bold metrics.', accent: '#1f3a5f', fontFamily: '"Source Serif 4", "Times New Roman", serif', variant: 'senior' },
  { id: 'product', name: 'Product Strategist', description: 'Outcome-driven layout for PM roles.', accent: '#2b3a55', fontFamily: '"IBM Plex Sans", "Segoe UI", Arial, sans-serif', variant: 'modern' },
  { id: 'portfolio', name: 'Creative Portfolio', description: 'Project-rich layout for designers and makers.', accent: '#7a3e20', fontFamily: '"Playfair Display", "Georgia", serif', variant: 'student' },
  { id: 'technical', name: 'Technical Leader', description: 'Condensed layout for engineering impact.', accent: '#111', fontFamily: '"IBM Plex Sans", "Roboto Mono", monospace', variant: 'classic' },
] as const;

type TemplateMeta = (typeof templateList)[number];
export const templates: TemplateMeta[] = templateList;
export type TemplateId = TemplateMeta['id'];

const variantRenderers: Record<TemplateVariant, (props: RenderProps) => JSX.Element> = {
  classic: (props) => <ClassicTemplate {...props} />,
  modern: (props) => <ModernTemplate {...props} />,
  student: (props) => <StudentTemplate {...props} />,
  senior: (props) => <SeniorTemplate {...props} />,
};

type RenderProps = {
  resume: ResumeImportResult;
  compact: boolean;
  accent: string;
  fontFamily: string;
  spacingClass: string;
};

export function TemplatePreview({
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
  const renderProps: RenderProps = {
    resume,
    compact,
    accent,
    fontFamily,
    spacingClass,
  };
  const variant = config.variant ?? 'classic';
  const renderer = variantRenderers[variant];
  return renderer(renderProps);
}

function ClassicTemplate({ resume, compact, accent, fontFamily, spacingClass }: { resume: ResumeImportResult; compact: boolean; accent: string; fontFamily: string; spacingClass: string }) {
  const experience = resume.experience.filter(isPreviewExperience);
  const education = resume.education.filter(isPreviewEducation);
  const skills = resume.skills.filter((item) => item.trim().length > 0);
  return (
    <div className={`template-doc ${spacingClass} ${compact ? 'compact' : ''}`} style={{ fontFamily, color: '#111' }}>
      <div className="template-header" style={{ borderBottomColor: accent }}>
        <div>
          <strong className="template-title">{resume.title || resume.contact?.fullName || 'Untitled Resume'}</strong>
          <div className="template-meta">
            {resume.contact?.email || ''} {resume.contact?.phone || ''} {resume.contact?.location || ''}
          </div>
        </div>
        <div className="template-accent" style={{ background: accent }} />
      </div>
      <Section title="Summary" accent={accent} compact={compact}>
        <p className="small">{resume.summary || 'No summary added yet.'}</p>
      </Section>
      <Section title="Skills" accent={accent} compact={compact}>
        <p className="small">{skills.length ? skills.join(', ') : 'No skills added yet.'}</p>
      </Section>
      <Section title="Experience" accent={accent} compact={compact}>
        {experience.length ? experience.map((exp, idx) => (
          <div key={`classic-exp-${idx}`} className="template-item">
            <div className="template-item__head">
              <strong>{exp.role}</strong>
              <span>{exp.company}</span>
              <span className="template-dates">{exp.startDate} - {exp.endDate}</span>
            </div>
            <ul className="template-list">
              {exp.highlights.filter(Boolean).slice(0, compact ? 1 : 3).map((h, hIdx) => (
                <li key={`classic-exp-h-${hIdx}`} className="small">{h}</li>
              ))}
            </ul>
          </div>
        )) : <p className="small template-empty">No experience added yet.</p>}
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
        {education.length ? education.map((edu, idx) => (
          <div key={`classic-edu-${idx}`} className="small">
            {edu.degree} - {edu.institution}
          </div>
        )) : <p className="small template-empty">No education added yet.</p>}
      </Section>
    </div>
  );
}

function ModernTemplate({ resume, compact, accent, fontFamily, spacingClass }: { resume: ResumeImportResult; compact: boolean; accent: string; fontFamily: string; spacingClass: string }) {
  const experience = resume.experience.filter(isPreviewExperience);
  const education = resume.education.filter(isPreviewEducation);
  const skills = resume.skills.filter((item) => item.trim().length > 0);
  return (
    <div className={`template-doc modern ${spacingClass} ${compact ? 'compact' : ''}`} style={{ fontFamily, color: '#111' }}>
      <div className="template-header modern" style={{ borderBottomColor: accent }}>
        <div>
          <strong className="template-title">{resume.title || resume.contact?.fullName || 'Untitled Resume'}</strong>
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
            <p className="small">{resume.summary || 'No summary added yet.'}</p>
          </Section>
          <Section title="Experience" accent={accent} compact={compact}>
            {experience.length ? experience.map((exp, idx) => (
              <div key={`modern-exp-${idx}`} className="template-item">
                <div className="template-item__head">
                  <strong>{exp.role}</strong>
                  <span>{exp.company}</span>
                </div>
                <div className="template-dates">{exp.startDate} - {exp.endDate}</div>
                <ul className="template-list">
                  {exp.highlights.filter(Boolean).slice(0, compact ? 1 : 3).map((h, hIdx) => (
                    <li key={`modern-exp-h-${hIdx}`} className="small">{h}</li>
                  ))}
                </ul>
              </div>
            )) : <p className="small template-empty">No experience added yet.</p>}
          </Section>
        </div>
        <div>
          <Section title="Skills" accent={accent} compact={compact}>
            <div className="template-skill-grid">
              {skills.slice(0, compact ? 6 : 10).map((skill, idx) => (
                <span key={`modern-skill-${idx}`} className="template-chip">{skill}</span>
              ))}
            </div>
            {!skills.length && <p className="small template-empty">No skills added yet.</p>}
          </Section>
          <Section title="Education" accent={accent} compact={compact}>
            {education.length ? education.map((edu, idx) => (
              <div key={`modern-edu-${idx}`} className="small">
                <strong>{edu.degree}</strong>
                <div>{edu.institution}</div>
              </div>
            )) : <p className="small template-empty">No education added yet.</p>}
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
  const experience = resume.experience.filter(isPreviewExperience);
  const education = resume.education.filter(isPreviewEducation);
  const skills = resume.skills.filter((item) => item.trim().length > 0);
  return (
    <div className={`template-doc student ${spacingClass} ${compact ? 'compact' : ''}`} style={{ fontFamily, color: '#111' }}>
      <div className="template-header student" style={{ borderBottomColor: accent }}>
        <strong className="template-title">{resume.title || resume.contact?.fullName || 'Untitled Resume'}</strong>
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
        <p className="small">{skills.length ? skills.join(', ') : 'No skills added yet.'}</p>
      </Section>
      <Section title="Experience" accent={accent} compact={compact}>
        {experience.length ? experience.map((exp, idx) => (
          <div key={`student-exp-${idx}`} className="template-item">
            <div className="template-item__head">
              <strong>{exp.role}</strong>
              <span>{exp.company}</span>
            </div>
            <ul className="template-list">
              {exp.highlights.filter(Boolean).slice(0, compact ? 1 : 2).map((h, hIdx) => (
                <li key={`student-exp-h-${hIdx}`} className="small">{h}</li>
              ))}
            </ul>
          </div>
        )) : <p className="small template-empty">No experience added yet.</p>}
      </Section>
      <Section title="Education" accent={accent} compact={compact}>
        {education.length ? education.map((edu, idx) => (
          <div key={`student-edu-${idx}`} className="small">
            {edu.degree} - {edu.institution}
          </div>
        )) : <p className="small template-empty">No education added yet.</p>}
      </Section>
    </div>
  );
}

function SeniorTemplate({ resume, compact, accent, fontFamily, spacingClass }: { resume: ResumeImportResult; compact: boolean; accent: string; fontFamily: string; spacingClass: string }) {
  const experience = resume.experience.filter(isPreviewExperience);
  const education = resume.education.filter(isPreviewEducation);
  const skills = resume.skills.filter((item) => item.trim().length > 0);
  return (
    <div className={`template-doc senior ${spacingClass} ${compact ? 'compact' : ''}`} style={{ fontFamily, color: '#111' }}>
      <div className="template-header senior" style={{ borderBottomColor: accent }}>
        <div>
          <strong className="template-title">{resume.title || resume.contact?.fullName || 'Untitled Resume'}</strong>
          <div className="template-meta">{resume.contact?.email || ''} {resume.contact?.phone || ''}</div>
        </div>
        <div className="template-meta">{resume.contact?.location || ''}</div>
      </div>
      <Section title="Executive Summary" accent={accent} compact={compact}>
        <p className="small">{resume.summary || 'No summary added yet.'}</p>
      </Section>
      <Section title="Leadership & Impact" accent={accent} compact={compact}>
        {experience.length ? experience.map((exp, idx) => (
          <div key={`senior-exp-${idx}`} className="template-item">
            <div className="template-item__head">
              <strong>{exp.role}</strong>
              <span>{exp.company}</span>
              <span className="template-dates">{exp.startDate} - {exp.endDate}</span>
            </div>
            <ul className="template-list">
              {exp.highlights.filter(Boolean).slice(0, compact ? 1 : 3).map((h, hIdx) => (
                <li key={`senior-exp-h-${hIdx}`} className="small">{h}</li>
              ))}
            </ul>
          </div>
        )) : <p className="small template-empty">No experience added yet.</p>}
      </Section>
      <div className="template-columns">
        <Section title="Core Skills" accent={accent} compact={compact}>
          <div className="template-skill-grid">
            {skills.slice(0, compact ? 6 : 12).map((skill, idx) => (
              <span key={`senior-skill-${idx}`} className="template-chip">{skill}</span>
            ))}
          </div>
          {!skills.length && <p className="small template-empty">No skills added yet.</p>}
        </Section>
        <Section title="Education" accent={accent} compact={compact}>
          {education.length ? education.map((edu, idx) => (
            <div key={`senior-edu-${idx}`} className="small">
              {edu.degree} - {edu.institution}
            </div>
          )) : <p className="small template-empty">No education added yet.</p>}
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

function isPreviewExperience(item: ExperienceItem) {
  return Boolean(item.company || item.role || item.startDate || item.endDate || item.highlights.length);
}

function isPreviewEducation(item: EducationItem) {
  return Boolean(
    item.institution ||
    item.degree ||
    item.startDate ||
    item.endDate ||
    (item.details || []).length ||
    item.gpa != null ||
    item.percentage != null,
  );
}
