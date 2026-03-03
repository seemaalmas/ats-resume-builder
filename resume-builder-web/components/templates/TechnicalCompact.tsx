import React from 'react';
import { cleanList, contactLine, educationItems, experienceItems, fullNameOrTitle, type TemplateProps } from './templateUtils';

export default function TechnicalCompact({ resumeData }: TemplateProps) {
  const summary = String(resumeData.summary || '').trim();
  const skills = cleanList(resumeData.skills);
  const technicalSkills = cleanList(resumeData.technicalSkills);
  const softSkills = cleanList(resumeData.softSkills);
  const languages = cleanList(resumeData.languages);
  const experience = experienceItems(resumeData);
  const education = educationItems(resumeData);

  const groupedSkills = [
    technicalSkills.length ? `Technical: ${technicalSkills.join(', ')}` : '',
    softSkills.length ? `Soft: ${softSkills.join(', ')}` : '',
    skills.length ? `General: ${skills.join(', ')}` : '',
    languages.length ? `Languages: ${languages.join(', ')}` : '',
  ].filter(Boolean).join(' | ');

  return (
    <article className="ats-template ats-template--technical">
      <header className="ats-template__header">
        <h1>{fullNameOrTitle(resumeData)}</h1>
        {contactLine(resumeData) ? <p>{contactLine(resumeData)}</p> : null}
      </header>

      <section className="ats-section ats-section--tight">
        <h2>Summary</h2>
        <p>{summary || 'Add a concise technical summary.'}</p>
      </section>

      <section className="ats-section ats-section--tight">
        <h2>Skill Stack</h2>
        <p>{groupedSkills || 'Add technical and role-specific skills.'}</p>
      </section>

      <section className="ats-section ats-section--tight">
        <h2>Experience</h2>
        {experience.length ? experience.map((item, idx) => (
          <div className="ats-item" key={`tech-exp-${idx}`}>
            <h3>{item.role || 'Role'}{item.company ? ` @ ${item.company}` : ''}</h3>
            <p className="ats-item__meta">{item.startDate || ''}{item.endDate ? ` - ${item.endDate}` : ''}</p>
            <ul>
              {cleanList(item.highlights).map((line, lineIdx) => (
                <li key={`tech-exp-line-${idx}-${lineIdx}`}>{line}</li>
              ))}
            </ul>
          </div>
        )) : <p>No experience added.</p>}
      </section>

      <section className="ats-section ats-section--tight">
        <h2>Education</h2>
        {education.length ? education.map((item, idx) => (
          <div className="ats-item" key={`tech-edu-${idx}`}>
            <h3>{item.degree || 'Degree'}</h3>
            <p>{item.institution || ''}</p>
          </div>
        )) : <p>No education added.</p>}
      </section>
    </article>
  );
}
