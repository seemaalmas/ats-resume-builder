import React from 'react';
import { cleanList, contactLine, educationItems, experienceItems, fullNameOrTitle, projectItems, type TemplateProps } from './templateUtils';

export default function GraduateStarter({ resumeData }: TemplateProps) {
  const summary = String(resumeData.summary || '').trim();
  const skills = cleanList(resumeData.skills);
  const projects = projectItems(resumeData);
  const experience = experienceItems(resumeData);
  const education = educationItems(resumeData);

  return (
    <article className="ats-template ats-template--graduate">
      <header className="ats-template__header">
        <h1>{fullNameOrTitle(resumeData)}</h1>
        {contactLine(resumeData) ? <p>{contactLine(resumeData)}</p> : null}
      </header>

      <section className="ats-section">
        <h2>Summary</h2>
        <p>{summary || 'Add a short introduction aligned to your target role.'}</p>
      </section>

      <section className="ats-section">
        <h2>Education</h2>
        {education.length ? education.map((item, idx) => (
          <div className="ats-item" key={`grad-edu-${idx}`}>
            <h3>{item.degree || 'Degree'}</h3>
            <p>{item.institution || ''}</p>
          </div>
        )) : <p>No education added.</p>}
      </section>

      <section className="ats-section">
        <h2>Projects</h2>
        {projects.length ? projects.map((item, idx) => (
          <div className="ats-item" key={`grad-proj-${idx}`}>
            <h3>{item.name || 'Project'}</h3>
            <p className="ats-item__meta">{item.startDate || ''}{item.endDate ? ` - ${item.endDate}` : ''}</p>
            <ul>
              {cleanList(item.highlights).map((line, lineIdx) => (
                <li key={`grad-proj-line-${idx}-${lineIdx}`}>{line}</li>
              ))}
            </ul>
          </div>
        )) : <p>No projects added.</p>}
      </section>

      <section className="ats-section">
        <h2>Experience</h2>
        {experience.length ? experience.map((item, idx) => (
          <div className="ats-item" key={`grad-exp-${idx}`}>
            <h3>{item.role || 'Role'}{item.company ? `, ${item.company}` : ''}</h3>
            <p className="ats-item__meta">{item.startDate || ''}{item.endDate ? ` - ${item.endDate}` : ''}</p>
            <ul>
              {cleanList(item.highlights).map((line, lineIdx) => (
                <li key={`grad-exp-line-${idx}-${lineIdx}`}>{line}</li>
              ))}
            </ul>
          </div>
        )) : <p>No experience added.</p>}
      </section>

      <section className="ats-section">
        <h2>Skills</h2>
        <p>{skills.length ? skills.join(', ') : 'Add your strongest skills.'}</p>
      </section>
    </article>
  );
}
