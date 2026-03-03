import React from 'react';
import { cleanList, contactLine, educationItems, experienceItems, fullNameOrTitle, type TemplateProps } from './templateUtils';

export default function ClassicATS({ resumeData }: TemplateProps) {
  const summary = String(resumeData.summary || '').trim();
  const skills = cleanList(resumeData.skills);
  const experience = experienceItems(resumeData);
  const education = educationItems(resumeData);

  return (
    <article className="ats-template ats-template--classic">
      <header className="ats-template__header">
        <h1>{fullNameOrTitle(resumeData)}</h1>
        {contactLine(resumeData) ? <p>{contactLine(resumeData)}</p> : null}
      </header>

      <section className="ats-section">
        <h2>SUMMARY</h2>
        <p>{summary || 'Add a short professional summary.'}</p>
      </section>

      <section className="ats-section">
        <h2>SKILLS</h2>
        <p>{skills.length ? skills.join(', ') : 'Add role-relevant skills.'}</p>
      </section>

      <section className="ats-section">
        <h2>EXPERIENCE</h2>
        {experience.length ? experience.map((item, idx) => (
          <div className="ats-item" key={`classic-exp-${idx}`}>
            <h3>{item.role || 'Role'}{item.company ? `, ${item.company}` : ''}</h3>
            <p className="ats-item__meta">{item.startDate || ''}{item.endDate ? ` - ${item.endDate}` : ''}</p>
            <ul>
              {cleanList(item.highlights).map((line, lineIdx) => (
                <li key={`classic-exp-line-${idx}-${lineIdx}`}>{line}</li>
              ))}
            </ul>
          </div>
        )) : <p>No experience added.</p>}
      </section>

      <section className="ats-section">
        <h2>EDUCATION</h2>
        {education.length ? education.map((item, idx) => (
          <div className="ats-item" key={`classic-edu-${idx}`}>
            <h3>{item.degree || 'Degree'}</h3>
            <p>{item.institution || ''}</p>
          </div>
        )) : <p>No education added.</p>}
      </section>
    </article>
  );
}
