import React from 'react';
import { cleanList, contactLine, educationItems, experienceItems, fullNameOrTitle, type TemplateProps } from './templateUtils';

function formatImpactLine(line: string) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return '';
  return `Impact: ${trimmed}`;
}

export default function ExecutiveImpact({ resumeData }: TemplateProps) {
  const summary = String(resumeData.summary || '').trim();
  const skills = cleanList(resumeData.skills);
  const experience = experienceItems(resumeData);
  const education = educationItems(resumeData);

  return (
    <article className="ats-template ats-template--executive">
      <header className="ats-template__header ats-template__header--executive">
        <h1>{fullNameOrTitle(resumeData)}</h1>
        {contactLine(resumeData) ? <p>{contactLine(resumeData)}</p> : null}
      </header>

      <section className="ats-section">
        <h2 className="ats-upper">EXECUTIVE SUMMARY</h2>
        <p>{summary || 'Add leadership summary with measurable outcomes.'}</p>
      </section>

      <section className="ats-section">
        <h2 className="ats-upper">CORE CAPABILITIES</h2>
        <p>{skills.length ? skills.join(', ') : 'Add strategic and functional capabilities.'}</p>
      </section>

      <section className="ats-section">
        <h2 className="ats-upper">PROFESSIONAL IMPACT</h2>
        {experience.length ? experience.map((item, idx) => (
          <div className="ats-item" key={`exec-exp-${idx}`}>
            <h3>{item.role || 'Role'}{item.company ? `, ${item.company}` : ''}</h3>
            <p className="ats-item__meta">{item.startDate || ''}{item.endDate ? ` - ${item.endDate}` : ''}</p>
            <ul className="ats-list--impact">
              {cleanList(item.highlights).map((line, lineIdx) => (
                <li key={`exec-exp-line-${idx}-${lineIdx}`}>{formatImpactLine(line)}</li>
              ))}
            </ul>
          </div>
        )) : <p>No experience added.</p>}
      </section>

      <section className="ats-section">
        <h2 className="ats-upper">EDUCATION</h2>
        {education.length ? education.map((item, idx) => (
          <div className="ats-item" key={`exec-edu-${idx}`}>
            <h3>{item.degree || 'Degree'}</h3>
            <p>{item.institution || ''}</p>
          </div>
        )) : <p>No education added.</p>}
      </section>
    </article>
  );
}
