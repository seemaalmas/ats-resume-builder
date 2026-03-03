import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResumeImportResult } from 'resume-builder-shared';
import ClassicATS from '@/components/templates/ClassicATS';
import ExecutiveImpact from '@/components/templates/ExecutiveImpact';
import GraduateStarter from '@/components/templates/GraduateStarter';
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
  assert(markup.includes('Professional Summary'));
  assert(markup.includes('Skills'));
});

test('Executive Impact template renders uppercase leadership sections', () => {
  const markup = renderToStaticMarkup(React.createElement(ExecutiveImpact, { resumeData }));
  assert(markup.includes('EXECUTIVE SUMMARY'));
  assert(markup.includes('PROFESSIONAL IMPACT'));
});

test('Technical Compact template renders grouped skills', () => {
  const markup = renderToStaticMarkup(React.createElement(TechnicalCompact, { resumeData }));
  assert(markup.includes('Skill Stack'));
  assert(markup.includes('Technical:'));
});

test('Graduate Starter template keeps projects before experience', () => {
  const markup = renderToStaticMarkup(React.createElement(GraduateStarter, { resumeData }));
  assert(markup.indexOf('<h2>Projects</h2>') < markup.indexOf('<h2>Experience</h2>'));
});
