const express = require('express');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const app = express();
app.use(express.json());

const port = Number(process.env.SMS_GATEWAY_PORT || 7071);
const backend = (process.env.SMS_BACKEND || 'gammu').trim().toLowerCase();
const device = process.env.GSM_DEVICE;

app.post('/send-sms', async (req, res) => {
  if (backend !== 'gammu') {
    return res.status(500).json({ ok: false, error: 'Unsupported SMS_BACKEND' });
  }
  const { to, message } = req.body || {};
  if (!to || !message) {
    return res.status(400).json({ ok: false, error: 'Both to and message are required' });
  }
  try {
    const args = ['sendsms', 'TEXT', to, '-text', String(message)];
    if (device) {
      args.push('-device', device);
    }
    await execFileAsync('gammu', args);
    return res.json({ ok: true });
  } catch (error) {
    const err = /** @type {NodeJS.ErrnoException} */ (error);
    if (err && err.code === 'ENOENT') {
      return res.status(500).json({ ok: false, error: 'Gammu not installed' });
    }
    const messageText = err?.message || 'Unknown error from Gammu';
    return res.status(500).json({ ok: false, error: `Gammu error: ${messageText}` });
  }
});

app.listen(port, () => {
  console.log(`SMS gateway listening on port ${port}`);
});
