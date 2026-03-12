import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResumeImportResult } from 'resume-builder-shared';
import ClassicATS from '@/components/templates/ClassicATS';
import ConsultantClean from '@/components/templates/ConsultantClean';
import ExecutiveImpact from '@/components/templates/ExecutiveImpact';
import MinimalClean from '@/components/templates/MinimalClean';
import ModernProfessional from '@/components/templates/ModernProfessional';
import TechnicalCompact from '@/components/templates/TechnicalCompact';

const resumeData: ResumeImportResult = {
  title: 'Sample Resume',
  contact: { fullName: 'Jane Doe', email: 'jane@example.com', phone: '555-0199', location: 'Remote' },
  summary: 'Experienced leader aligning product and engineering teams.',
  skills: ['Leadership', 'Communication'],
  technicalSkills: ['TypeScript'],
  softSkills: ['Mentorship'],
  languages: ['English'],
  experience: [
    {
      company: 'Acme Corp',
      role: 'Lead Engineer',
      startDate: 'Jan 2020',
      endDate: 'Present',
      highlights: ['Delivered three major launches', 'Coached a cross-functional squad'],
    },
  ],
  education: [
    {
      institution: 'State University',
      degree: 'B.S. Computer Science',
      startDate: '2010',
      endDate: '2014',
      details: [],
    },
  ],
  projects: [
    {
      name: 'Platform Migration',
      highlights: ['Led strategy', 'Documented rollout'],
    },
  ],
  certifications: [
    { name: 'PMP' },
  ],
};

test('Classic ATS template renders summary and experience', () => {
  const markup = renderToStaticMarkup(React.createElement(ClassicATS, { resumeData }));
  assert(markup.includes('SUMMARY'));
  assert(markup.includes('EXPERIENCE'));
});

test('Modern Professional template renders divider sections', () => {
  const markup = renderToStaticMarkup(React.createElement(ModernProfessional, { resumeData }));
  assert(markup.includes('Summary'));
  assert(markup.includes('Skills'));
  assert(markup.indexOf('<h2>Summary</h2>') < markup.indexOf('<h2>Skills</h2>'));
  assert(markup.indexOf('<h2>Skills</h2>') < markup.indexOf('<h2>Experience</h2>'));
});

test('Executive Impact template uses ATS section names and no legacy impact prefixes', () => {
  const markup = renderToStaticMarkup(React.createElement(ExecutiveImpact, { resumeData }));
  assert(markup.includes('SUMMARY'));
  assert(markup.includes('SKILLS'));
  assert(markup.includes('EXPERIENCE'));
  assert(!markup.includes('EXECUTIVE SUMMARY'));
  assert(!markup.includes('PROFESSIONAL IMPACT'));
  assert(!markup.includes('Impact:'), 'Executive template should not prefix each bullet with "Impact:"');
});

test('Technical Compact template renders grouped skills', () => {
  const markup = renderToStaticMarkup(React.createElement(TechnicalCompact, { resumeData }));
  assert(markup.includes('<h2>Skills</h2>'));
  assert(markup.includes('Technical:'));
});

test('Minimal Clean template keeps ATS section order with experience before projects', () => {
  const markup = renderToStaticMarkup(React.createElement(MinimalClean, { resumeData }));
  assert(markup.indexOf('<h2>Summary</h2>') < markup.indexOf('<h2>Skills</h2>'));
  assert(markup.indexOf('<h2>Skills</h2>') < markup.indexOf('<h2>Experience</h2>'));
  assert(markup.indexOf('<h2>Experience</h2>') < markup.indexOf('<h2>Projects</h2>'));
});

test('Consultant Clean template keeps ATS naming and single-column sections', () => {
  const markup = renderToStaticMarkup(React.createElement(ConsultantClean, { resumeData }));
  assert(markup.includes('<h2>Summary</h2>'));
  assert(markup.includes('<h2>Skills</h2>'));
  assert(markup.includes('<h2>Experience</h2>'));
  assert(!markup.includes('Impact:'), 'Consultant template should not force legacy prefixes');
});
