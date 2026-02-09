import { HttpException, HttpStatus } from '@nestjs/common';

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export function rateLimitOrThrow(options: {
  key: string;
  limit: number;
  windowMs: number;
  message: string;
}) {
  const now = Date.now();
  const existing = windows.get(options.key);
  if (!existing || existing.resetAt <= now) {
    windows.set(options.key, { count: 1, resetAt: now + options.windowMs });
    return;
  }
  if (existing.count >= options.limit) {
    throw new HttpException(options.message, HttpStatus.TOO_MANY_REQUESTS);
  }
  existing.count += 1;
}
