import express from 'express';
import { aiRouter } from './routes/ai.routes';

export function createServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/ai', aiRouter);
  return app;
}
