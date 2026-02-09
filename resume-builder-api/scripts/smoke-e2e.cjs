/* eslint-disable no-console */
const { PrismaClient } = require('@prisma/client');

const apiBase = process.env.SMOKE_API_URL || 'http://localhost:5000';
const email = `smoke.${Date.now()}@example.com`;
const password = 'SmokeTest@1234';
const shouldCleanup = process.env.SMOKE_CLEANUP === '1';

const results = [];
let accessToken = '';
let userId = '';
let resumeId = '';

function addResult(step, pass, detail) {
  results.push({ step, pass, detail });
}

function fmtErr(err) {
  if (!err) return 'Unknown error';
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function request(path, opts = {}, token = '') {
  const headers = { ...(opts.headers || {}) };
  const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;

  if (!isFormData && opts.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${apiBase}${path}`, { ...opts, headers });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} :: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function waitForHealth(timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const health = await request('/health', { method: 'GET' });
      if (health && health.ok === true) return health;
    } catch {
      // service not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('API health check timed out');
}

function escapePdfText(line) {
  return String(line).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdf(lines) {
  const streamLines = ['BT', '/F1 11 Tf', '14 TL', '72 760 Td'];
  lines.forEach((line, idx) => {
    if (idx > 0) streamLines.push('T*');
    streamLines.push(`(${escapePdfText(line)}) Tj`);
  });
  streamLines.push('ET');
  const stream = `${streamLines.join('\n')}\n`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (let i = 0; i < objects.length; i += 1) {
    offsets[i + 1] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

async function cleanup() {
  if (!shouldCleanup) return;
  const prisma = new PrismaClient();
  try {
    if (resumeId) {
      await prisma.resume.delete({ where: { id: resumeId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
    addResult('cleanup', true, 'Deleted smoke resume and user');
  } catch (err) {
    addResult('cleanup', false, fmtErr(err));
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  try {
    const health = await waitForHealth();
    addResult('health-check', health?.ok === true, JSON.stringify(health));
    if (health?.ok !== true) throw new Error('Health check failed');
  } catch (err) {
    addResult('health-check', false, fmtErr(err));
    await cleanup();
    return;
  }

  try {
    const reg = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ fullName: 'Smoke User', email, password }),
    });
    accessToken = reg.accessToken;
    userId = reg.user?.id || '';
    if (!accessToken || !userId) throw new Error('Missing accessToken or userId');
    addResult('register', true, `userId=${userId}`);
  } catch (err) {
    addResult('register', false, fmtErr(err));
    await cleanup();
    return;
  }

  try {
    const prisma = new PrismaClient();
    await prisma.user.update({ where: { id: userId }, data: { plan: 'STUDENT' } });
    await prisma.$disconnect();
    addResult('plan-upgrade-for-smoke', true, 'Set user plan to STUDENT');
  } catch (err) {
    addResult('plan-upgrade-for-smoke', false, fmtErr(err));
    await cleanup();
    return;
  }

  const basePayload = {
    title: 'Smoke Resume',
    contact: {
      fullName: 'Smoke User',
      email,
      phone: '+1 555 123 4567',
      location: 'San Francisco, CA',
      links: ['https://linkedin.com/in/smoke-user'],
    },
    summary: 'Results-driven software engineer with experience delivering measurable product impact across APIs and frontend systems.',
    skills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'REST APIs', 'Testing'],
    experience: [
      {
        company: 'Acme Corp',
        role: 'Software Engineer',
        startDate: '2021',
        endDate: 'Present',
        highlights: [
          'Built internal API tooling that reduced incident triage time by 35%.',
          'Improved query performance by 42% through indexing and query refactors.',
        ],
      },
    ],
    education: [
      {
        institution: 'State University',
        degree: 'B.S. Computer Science',
        startDate: '2016',
        endDate: '2020',
        details: ['Graduated with honors'],
      },
    ],
    projects: [],
    certifications: [],
  };

  try {
    const created = await request('/resumes', {
      method: 'POST',
      body: JSON.stringify(basePayload),
    }, accessToken);
    resumeId = created.id;
    if (!resumeId) throw new Error('Missing resume id in create response');
    addResult('create-resume', true, `resumeId=${resumeId}`);
  } catch (err) {
    addResult('create-resume', false, fmtErr(err));
    await cleanup();
    return;
  }

  try {
    const pdfLines = [
      'Smoke User',
      'Profile',
      'Senior software engineer with 5 years delivering scalable backend systems.',
      'Core Skills',
      'TypeScript, Node.js, PostgreSQL, AWS, CI/CD, Distributed Systems',
      'Employment History',
      'Senior Software Engineer @ Acme Corp 2022 - Present',
      '- Led migration that improved throughput by 40 percent',
      'Software Engineer @ Beta Systems 2019 - 2022',
      '- Built billing platform APIs used by 120 enterprise customers',
      'Academic Background',
      'B.S. Computer Science - State University 2015 - 2019',
    ];
    const pdfBuffer = buildPdf(pdfLines);
    const form = new FormData();
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    form.append('file', blob, 'smoke-import.pdf');

    const ingest = await request(`/resumes/${resumeId}/ingest`, {
      method: 'POST',
      body: form,
    }, accessToken);

    const mappedExperience = ingest?.mapped?.experience?.length ?? 0;
    addResult('upload-ingest', true, `mappedExperience=${mappedExperience}, roleLevel=${ingest?.mapped?.roleLevel || 'n/a'}`);
  } catch (err) {
    addResult('upload-ingest', false, fmtErr(err));
    await cleanup();
    return;
  }

  try {
    const patchPayload = {
      ...basePayload,
      title: 'Smoke Resume Autosave',
      summary: `${basePayload.summary} Led cross-team delivery with clear outcomes.`,
    };
    const updated = await request(`/resumes/${resumeId}`, {
      method: 'PATCH',
      body: JSON.stringify(patchPayload),
    }, accessToken);

    if (!String(updated?.title || '').includes('Autosave')) {
      throw new Error('PATCH did not return expected updated title');
    }
    addResult('autosave-patch', true, `updatedTitle=${updated.title}`);
  } catch (err) {
    addResult('autosave-patch', false, fmtErr(err));
    await cleanup();
    return;
  }

  try {
    const ats = await request(`/resumes/${resumeId}/ats-score`, {
      method: 'POST',
      body: JSON.stringify({
        jdText: 'Looking for a senior software engineer with TypeScript, Node.js, PostgreSQL, REST APIs, AWS and measurable delivery impact.',
      }),
    }, accessToken);
    addResult('ats-score', true, `score=${ats.roleAdjustedScore}, roleLevel=${ats.roleLevel}`);
  } catch (err) {
    addResult('ats-score', false, fmtErr(err));
    await cleanup();
    return;
  }

  await cleanup();
}

main()
  .catch((err) => {
    addResult('script-runtime', false, fmtErr(err));
  })
  .finally(() => {
    const passCount = results.filter((r) => r.pass).length;
    const failCount = results.length - passCount;
    console.log(JSON.stringify({
      apiBase,
      email,
      userId,
      resumeId,
      passCount,
      failCount,
      results,
    }, null, 2));
    process.exitCode = failCount ? 1 : 0;
  });
