import type { ResumeImportResult } from 'resume-builder-shared';

export const sampleResumeData: ResumeImportResult = {
  title: 'Aarav Mehta - Senior Frontend Engineer',
  contact: {
    fullName: 'Aarav Mehta',
    email: 'aarav.mehta@example.com',
    phone: '+91 98765 43210',
    location: 'Bengaluru, India',
    links: ['linkedin.com/in/aaravmehta', 'github.com/aaravmehta'],
  },
  summary:
    'Senior Frontend Engineer with 8+ years building high-performance web applications and design systems used by distributed product teams.',
  skills: [
    'TypeScript',
    'React',
    'Next.js',
    'Accessibility',
    'Performance Optimization',
    'Testing',
    'Node.js',
    'GraphQL',
  ],
  technicalSkills: ['TypeScript', 'React', 'Next.js', 'Node.js', 'GraphQL', 'Jest', 'Playwright'],
  softSkills: ['Mentoring', 'Cross-functional Collaboration', 'Product Thinking'],
  languages: ['English', 'Hindi'],
  experience: [
    {
      company: 'Nimbus Labs',
      role: 'Senior Frontend Engineer',
      startDate: '2021-04',
      endDate: 'Present',
      highlights: [
        'Built a reusable UI platform that reduced feature delivery time by 35%.',
        'Improved Core Web Vitals across customer dashboards and lifted conversion by 14%.',
        'Led migration to TypeScript and standardized testing practices for 20+ engineers.',
      ],
    },
    {
      company: 'BlueOrbit Technologies',
      role: 'Frontend Engineer',
      startDate: '2017-01',
      endDate: '2021-03',
      highlights: [
        'Developed modular React interfaces for enterprise reporting and analytics workflows.',
        'Implemented accessibility fixes to meet WCAG AA compliance across product surfaces.',
        'Partnered with product and design to launch template-based onboarding experiences.',
      ],
    },
  ],
  education: [
    {
      institution: 'National Institute of Technology',
      degree: 'B.Tech in Computer Science',
      startDate: '2012-07',
      endDate: '2016-05',
      details: ['Focused on software engineering, distributed systems, and web technologies.'],
    },
  ],
  projects: [
    {
      name: 'Resume Signal Analyzer',
      role: 'Creator',
      startDate: '2024-02',
      endDate: '2024-09',
      highlights: [
        'Created a parser pipeline for extracting structured resume signals from uploaded documents.',
        'Implemented scoring explanations to guide users on ATS-improving edits.',
      ],
    },
  ],
  certifications: [
    {
      name: 'Google Professional Cloud Developer',
      issuer: 'Google Cloud',
      date: '2023-08',
    },
  ],
};


