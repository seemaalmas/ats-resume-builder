import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendTemplates } from '@/src/lib/template-recommendation';
import type { ResumeDraft } from '@/src/lib/resume-store';

const seniorResume: ResumeDraft = {
  title: 'Senior Engineering Leader',
  contact: { fullName: 'Alex Rivera', email: 'alex@company.com', phone: '555-0100', location: 'New York' },
  summary: '9+ years building reliable infrastructure and guiding teams.',
  skills: ['Architecture', 'Scaling Systems', 'Coaching'],
  technicalSkills: ['Distributed Systems', 'Go'],
  softSkills: ['Mentorship'],
  languages: ['English'],
  experience: Array.from({ length: 5 }, (_, idx) => ({
    company: `Company ${idx + 1}`,
    role: idx === 0 ? 'Staff Engineer' : 'Engineer',
    startDate: 'Jan 2015',
    endDate: 'Dec 2020',
    highlights: ['Delivered resilient platforms', 'Coached teams'],
  })),
  education: [
    { institution: 'Tech University', degree: 'B.S. Computer Science', startDate: '2010', endDate: '2014', details: [] },
  ],
  projects: [],
  certifications: [{ name: 'Certified Leader' }],
};

const productResume: ResumeDraft = {
  title: 'Product Manager',
  contact: { fullName: 'Lena Patel', email: 'lena@studio.com', location: 'San Francisco' },
  summary: 'Product strategist leading launch teams for SaaS products.',
  skills: ['Roadmapping', 'Customer Research'],
  technicalSkills: ['Analytics'],
  softSkills: ['Collaboration'],
  languages: ['English'],
  experience: [
    {
    company: 'Innovate Labs',
    role: 'Product Manager',
    startDate: 'Jan 2024',
    endDate: 'Present',
      highlights: ['Launched AI platform', 'Aligned cross-functional partners'],
    },
  ],
  education: [
    { institution: 'Design College', degree: 'MBA', startDate: '2016', endDate: '2018', details: [] },
  ],
  projects: [],
  certifications: [{ name: 'Agile PM' }],
};

test('Senior resume recommends executive impact layout', () => {
  const result = recommendTemplates(seniorResume);
  assert.equal(result.primaryTemplateId, 'executive');
  assert(result.reasons.length > 0);
});

test('Product resume recommends modern layout for business focus', () => {
  const result = recommendTemplates(productResume);
  assert.equal(result.primaryTemplateId, 'modern');
  assert(result.reasons[0].toLowerCase().includes('product'));
});


