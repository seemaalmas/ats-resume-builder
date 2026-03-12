import React from 'react';
import {
  certificationItems,
  cleanList,
  contactLine,
  displayDateRange,
  educationItems,
  experienceItems,
  fullNameOrTitle,
  normalizeTemplateResume,
  projectItems,
  sectionTitle,
  type TemplateProps,
} from './templateUtils';

export default function ConsultantClean({ resumeData }: TemplateProps) {
  const normalized = normalizeTemplateResume(resumeData);
  const summary = String(normalized.summary || '').trim();
  const skills = cleanList(normalized.skills);
  const languages = cleanList(normalized.languages);
  const experience = experienceItems(normalized);
  const projects = projectItems(normalized);
  const education = educationItems(normalized);
  const certifications = certificationItems(normalized);

  return (
    <article className="ats-template ats-template--consultant">
      <header className="ats-template__header ats-template__header--bar">
        <h1>{fullNameOrTitle(normalized)}</h1>
        {contactLine(normalized) ? <p>{contactLine(normalized)}</p> : null}
      </header>

      <section className="ats-section ats-section--divided">
        <h2>{sectionTitle('summary')}</h2>
        <p>{summary || 'Add a concise summary with business outcomes and delivery scope.'}</p>
      </section>

      <section className="ats-section ats-section--divided">
        <h2>{sectionTitle('skills')}</h2>
        <p>{skills.length ? skills.join(', ') : 'Add consulting, domain, and execution skills.'}</p>
      </section>

      <section className="ats-section ats-section--divided">
        <h2>{sectionTitle('experience')}</h2>
        {experience.length ? experience.map((item, idx) => (
          <div className="ats-item" key={`consultant-exp-${idx}`}>
            <h3>{item.role || 'Role'}{item.company ? ` | ${item.company}` : ''}</h3>
            {displayDateRange(item.startDate, item.endDate) ? <p className="ats-item__meta">{displayDateRange(item.startDate, item.endDate)}</p> : null}
            <ul>
              {cleanList(item.highlights).map((line, lineIdx) => (
                <li key={`consultant-exp-line-${idx}-${lineIdx}`}>{line}</li>
              ))}
            </ul>
          </div>
        )) : <p>No experience added.</p>}
      </section>

      {projects.length ? (
        <section className="ats-section ats-section--divided">
          <h2>{sectionTitle('projects')}</h2>
          {projects.map((item, idx) => (
            <div className="ats-item" key={`consultant-project-${idx}`}>
              <h3>{item.name || 'Project'}</h3>
              {displayDateRange(item.startDate || '', item.endDate || '') ? <p className="ats-item__meta">{displayDateRange(item.startDate || '', item.endDate || '')}</p> : null}
              <ul>
                {cleanList(item.highlights).map((line, lineIdx) => (
                  <li key={`consultant-project-line-${idx}-${lineIdx}`}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <section className="ats-section ats-section--divided">
        <h2>{sectionTitle('education')}</h2>
        {education.length ? education.map((item, idx) => (
          <div className="ats-item" key={`consultant-edu-${idx}`}>
            <h3>{item.degree || 'Degree'}</h3>
            <p>{item.institution || ''}</p>
            {displayDateRange(item.startDate, item.endDate) ? <p className="ats-item__meta">{displayDateRange(item.startDate, item.endDate)}</p> : null}
          </div>
        )) : <p>No education added.</p>}
      </section>

      {certifications.length ? (
        <section className="ats-section ats-section--divided">
          <h2>{sectionTitle('certifications')}</h2>
          {certifications.map((item, idx) => (
            <div className="ats-item" key={`consultant-cert-${idx}`}>
              <h3>{item.name || 'Certification'}</h3>
              <p>{[item.issuer, displayDateRange(item.date || '', '')].filter(Boolean).join(' | ')}</p>
            </div>
          ))}
        </section>
      ) : null}

      {languages.length ? (
        <section className="ats-section">
          <h2>{sectionTitle('languages')}</h2>
          <p>{languages.join(', ')}</p>
        </section>
      ) : null}
    </article>
  );
}
