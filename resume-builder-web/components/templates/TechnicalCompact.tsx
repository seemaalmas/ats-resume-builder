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

export default function TechnicalCompact({ resumeData }: TemplateProps) {
  const normalized = normalizeTemplateResume(resumeData);
  const summary = String(normalized.summary || '').trim();
  const skills = cleanList(normalized.skills);
  const technicalSkills = cleanList(normalized.technicalSkills);
  const softSkills = cleanList(normalized.softSkills);
  const languages = cleanList(normalized.languages);
  const experience = experienceItems(normalized);
  const projects = projectItems(normalized);
  const education = educationItems(normalized);
  const certifications = certificationItems(normalized);

  const groupedSkills = [
    technicalSkills.length ? `Technical: ${technicalSkills.join(', ')}` : '',
    softSkills.length ? `Soft: ${softSkills.join(', ')}` : '',
    skills.length ? `General: ${skills.join(', ')}` : '',
  ].filter(Boolean).join(' | ');

  return (
    <article className="ats-template ats-template--technical">
      <header className="ats-template__header">
        <h1>{fullNameOrTitle(normalized)}</h1>
        {contactLine(normalized) ? <p>{contactLine(normalized)}</p> : null}
      </header>

      <section className="ats-section ats-section--tight">
        <h2>{sectionTitle('summary')}</h2>
        <p>{summary || 'Add a concise technical summary.'}</p>
      </section>

      <section className="ats-section ats-section--tight">
        <h2>{sectionTitle('skills')}</h2>
        <p>{groupedSkills || 'Add technical and role-specific skills.'}</p>
      </section>

      <section className="ats-section ats-section--tight">
        <h2>{sectionTitle('experience')}</h2>
        {experience.length ? experience.map((item, idx) => (
          <div className="ats-item" key={`tech-exp-${idx}`}>
            <h3>{item.role || 'Role'}{item.company ? ` @ ${item.company}` : ''}</h3>
            {displayDateRange(item.startDate, item.endDate) ? <p className="ats-item__meta">{displayDateRange(item.startDate, item.endDate)}</p> : null}
            <ul>
              {cleanList(item.highlights).map((line, lineIdx) => (
                <li key={`tech-exp-line-${idx}-${lineIdx}`}>{line}</li>
              ))}
            </ul>
          </div>
        )) : <p>No experience added.</p>}
      </section>

      {projects.length ? (
        <section className="ats-section ats-section--tight">
          <h2>{sectionTitle('projects')}</h2>
          {projects.map((item, idx) => (
            <div className="ats-item" key={`tech-project-${idx}`}>
              <h3>{item.name || 'Project'}</h3>
              {displayDateRange(item.startDate || '', item.endDate || '') ? <p className="ats-item__meta">{displayDateRange(item.startDate || '', item.endDate || '')}</p> : null}
              <ul>
                {cleanList(item.highlights).map((line, lineIdx) => (
                  <li key={`tech-project-line-${idx}-${lineIdx}`}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <section className="ats-section ats-section--tight">
        <h2>{sectionTitle('education')}</h2>
        {education.length ? education.map((item, idx) => (
          <div className="ats-item" key={`tech-edu-${idx}`}>
            <h3>{item.degree || 'Degree'}</h3>
            <p>{item.institution || ''}</p>
            {displayDateRange(item.startDate, item.endDate) ? <p className="ats-item__meta">{displayDateRange(item.startDate, item.endDate)}</p> : null}
          </div>
        )) : <p>No education added.</p>}
      </section>

      {certifications.length ? (
        <section className="ats-section ats-section--tight">
          <h2>{sectionTitle('certifications')}</h2>
          {certifications.map((item, idx) => (
            <div className="ats-item" key={`tech-cert-${idx}`}>
              <h3>{item.name || 'Certification'}</h3>
              <p>{[item.issuer, displayDateRange(item.date || '', '')].filter(Boolean).join(' | ')}</p>
            </div>
          ))}
        </section>
      ) : null}

      {languages.length ? (
        <section className="ats-section ats-section--tight">
          <h2>{sectionTitle('languages')}</h2>
          <p>{languages.join(', ')}</p>
        </section>
      ) : null}
    </article>
  );
}
