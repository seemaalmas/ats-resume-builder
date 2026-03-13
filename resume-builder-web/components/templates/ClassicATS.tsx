import React from 'react';
import {
  allSkills,
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

export default function ClassicATS({ resumeData }: TemplateProps) {
  const normalized = normalizeTemplateResume(resumeData);
  const summary = String(normalized.summary || '').trim();
  const skills = allSkills(normalized);
  const languages = cleanList(normalized.languages);
  const experience = experienceItems(normalized);
  const projects = projectItems(normalized);
  const education = educationItems(normalized);
  const certifications = certificationItems(normalized);

  return (
    <article className="ats-template ats-template--classic">
      <header className="ats-template__header">
        <h1>{fullNameOrTitle(normalized)}</h1>
        {contactLine(normalized) ? <p>{contactLine(normalized)}</p> : null}
      </header>

      <section className="ats-section">
        <h2>{sectionTitle('summary').toUpperCase()}</h2>
        <p>{summary || 'Add a short professional summary.'}</p>
      </section>

      <section className="ats-section">
        <h2>{sectionTitle('skills').toUpperCase()}</h2>
        <p>{skills.length ? skills.join(', ') : 'Add role-relevant skills.'}</p>
      </section>

      <section className="ats-section">
        <h2>{sectionTitle('experience').toUpperCase()}</h2>
        {experience.length ? experience.map((item, idx) => (
          <div className="ats-item" key={`classic-exp-${idx}`}>
            <h3>{item.role || 'Role'}{item.company ? `, ${item.company}` : ''}</h3>
            {displayDateRange(item.startDate, item.endDate) ? <p className="ats-item__meta">{displayDateRange(item.startDate, item.endDate)}</p> : null}
            <ul>
              {cleanList(item.highlights).map((line, lineIdx) => (
                <li key={`classic-exp-line-${idx}-${lineIdx}`}>{line}</li>
              ))}
            </ul>
          </div>
        )) : <p>No experience added.</p>}
      </section>

      {projects.length ? (
        <section className="ats-section">
          <h2>{sectionTitle('projects').toUpperCase()}</h2>
          {projects.map((item, idx) => (
            <div className="ats-item" key={`classic-project-${idx}`}>
              <h3>{item.name || 'Project'}</h3>
              {displayDateRange(item.startDate || '', item.endDate || '') ? <p className="ats-item__meta">{displayDateRange(item.startDate || '', item.endDate || '')}</p> : null}
              <ul>
                {cleanList(item.highlights).map((line, lineIdx) => (
                  <li key={`classic-project-line-${idx}-${lineIdx}`}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <section className="ats-section">
        <h2>{sectionTitle('education').toUpperCase()}</h2>
        {education.length ? education.map((item, idx) => (
          <div className="ats-item" key={`classic-edu-${idx}`}>
            <h3>{item.degree || 'Degree'}</h3>
            <p>{item.institution || ''}</p>
            {displayDateRange(item.startDate, item.endDate) ? <p className="ats-item__meta">{displayDateRange(item.startDate, item.endDate)}</p> : null}
          </div>
        )) : <p>No education added.</p>}
      </section>

      {certifications.length ? (
        <section className="ats-section">
          <h2>{sectionTitle('certifications').toUpperCase()}</h2>
          {certifications.map((item, idx) => (
            <div className="ats-item" key={`classic-cert-${idx}`}>
              <h3>{item.name || 'Certification'}</h3>
              <p>{[item.issuer, displayDateRange(item.date || '', '')].filter(Boolean).join(' | ')}</p>
            </div>
          ))}
        </section>
      ) : null}

      {languages.length ? (
        <section className="ats-section">
          <h2>{sectionTitle('languages').toUpperCase()}</h2>
          <p>{languages.join(', ')}</p>
        </section>
      ) : null}
    </article>
  );
}
