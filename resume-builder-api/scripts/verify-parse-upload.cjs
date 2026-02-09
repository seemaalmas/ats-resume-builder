/* eslint-disable no-console */
const fs = require('node:fs/promises');
const path = require('node:path');

const apiBase = process.env.SMOKE_API_URL || 'http://localhost:5000';
const email = `parse.upload.${Date.now()}@example.com`;
const password = 'UploadVerify@1234';

const checks = [];
let accessToken = '';

function addCheck(name, pass, detail) {
  checks.push({ name, pass, detail });
}

function passCount() {
  return checks.filter((item) => item.pass).length;
}

function failCount() {
  return checks.filter((item) => !item.pass).length;
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

async function request(pathname, init = {}, token = '') {
  const headers = { ...(init.headers || {}) };
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (!isFormData && init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${apiBase}${pathname}`, { ...init, headers });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  return { res, data };
}

async function waitForHealth(timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const health = await request('/health', { method: 'GET' });
      if (health.res.status === 200 && health.data?.ok === true) return health;
    } catch {
      // keep waiting until API is reachable
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('API health check timed out');
}

function hasStructuredPayload(data) {
  const parsed = data?.parsed || data;
  return Boolean(
    parsed &&
    typeof parsed.summary === 'string' &&
    Array.isArray(parsed.skills) &&
    Array.isArray(parsed.experience) &&
    Array.isArray(parsed.education),
  );
}

async function uploadFile(fileName, mime, buffer) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), fileName);
  return request('/resumes/parse-upload', { method: 'POST', body: form }, accessToken);
}

async function run() {
  try {
    const health = await waitForHealth();
    addCheck('health', health.res.status === 200 && health.data?.ok === true, JSON.stringify(health.data));
    if (health.res.status !== 200) throw new Error('API not ready');

    const reg = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ fullName: 'Parse Upload Verify', email, password }),
    });
    if (reg.res.status !== 201 && reg.res.status !== 200) throw new Error(`register failed: ${reg.res.status}`);
    accessToken = reg.data?.accessToken || '';
    addCheck('register', Boolean(accessToken), `status=${reg.res.status}`);
    if (!accessToken) throw new Error('missing access token');

    const pdf = buildPdf([
      'Upload Verify User',
      'Profile',
      'API engineer with measurable backend impact across reliability and throughput.',
      'Core Skills',
      'TypeScript, Node.js, PostgreSQL, AWS',
      'Employment History',
      'Senior Engineer @ Alpha Corp 2020 - Present',
      '- Improved throughput by 31 percent',
      'Academic Background',
      'B.S. Computer Science - Example University 2015 - 2019',
    ]);
    const pdfResp = await uploadFile('verify.pdf', 'application/pdf', pdf);
    addCheck(
      'upload-pdf-200',
      pdfResp.res.status === 200 && hasStructuredPayload(pdfResp.data),
      `status=${pdfResp.res.status}`,
    );

    const docxPath = path.join(process.cwd(), 'node_modules', 'mammoth', 'test', 'test-data', 'simple-list.docx');
    const docxBuffer = await fs.readFile(docxPath);
    const docxResp = await uploadFile(
      'verify.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      docxBuffer,
    );
    addCheck(
      'upload-docx-200',
      docxResp.res.status === 200 && hasStructuredPayload(docxResp.data),
      `status=${docxResp.res.status} body=${JSON.stringify(docxResp.data)}`,
    );

    const txtBuffer = Buffer.from(
      [
        'Upload Verify User',
        'Profile',
        'Platform engineer improving reliability and delivery metrics.',
        'Core Skills',
        'Node.js, TypeScript, SQL',
        'Employment History',
        'Engineer @ Beta Labs 2022 - Present',
        '- Reduced incident volume by 22 percent',
        'Academic Background',
        'B.S. CS - State University 2018 - 2022',
      ].join('\n'),
      'utf8',
    );
    const txtResp = await uploadFile('verify.txt', 'text/plain', txtBuffer);
    addCheck(
      'upload-txt-200',
      txtResp.res.status === 200 && hasStructuredPayload(txtResp.data),
      `status=${txtResp.res.status}`,
    );

    const missingFileResp = await request('/resumes/parse-upload', { method: 'POST', body: new FormData() }, accessToken);
    const missingFileMessage = JSON.stringify(missingFileResp.data);
    addCheck(
      'upload-missing-file-400',
      missingFileResp.res.status === 400 && missingFileMessage.includes('expected multipart field'),
      `status=${missingFileResp.res.status} body=${missingFileMessage}`,
    );

    const badResp = await uploadFile('invalid.bin', 'application/json', Buffer.from('{"x":1}', 'utf8'));
    const badMessage = JSON.stringify(badResp.data);
    addCheck(
      'upload-unsupported-mimetype-400',
      badResp.res.status === 400 && badMessage.toLowerCase().includes('unsupported mimetype'),
      `status=${badResp.res.status} body=${badMessage}`,
    );

    const big = Buffer.alloc(7 * 1024 * 1024, 'a');
    const bigResp = await uploadFile('big.txt', 'text/plain', big);
    const bigMessage = JSON.stringify(bigResp.data);
    addCheck(
      'upload-too-large-413',
      bigResp.res.status === 413 && bigMessage.toLowerCase().includes('file too large'),
      `status=${bigResp.res.status} body=${bigMessage}`,
    );
  } catch (err) {
    addCheck('script-runtime', false, err instanceof Error ? err.message : String(err));
  } finally {
    console.log(
      JSON.stringify(
        {
          apiBase,
          email,
          passCount: passCount(),
          failCount: failCount(),
          checks,
        },
        null,
        2,
      ),
    );
    process.exitCode = failCount() > 0 ? 1 : 0;
  }
}

run();
