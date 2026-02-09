import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowedOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
  app.use(
    json({
      limit: '1mb',
      verify: (req: any, _res, buf) => {
        if (req.originalUrl === '/billing/webhook') {
          req.rawBody = buf;
        }
      },
    }),
  );
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[bootstrap] Allowed CORS origins: ${allowedOrigins.join(', ')}`);
  }
  await app.listen(port);
}

bootstrap();

function parseAllowedOrigins(value?: string) {
  const fromEnv = (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  return ['http://localhost:3000', 'http://localhost:3001'];
}
