import type { ApiFieldError } from './api';

export function toFieldErrorMap(fields: ApiFieldError[]) {
  const next: Record<string, string> = {};
  for (const field of fields || []) {
    const path = toBracketErrorPath(field.path);
    const message = String(field.message || '').trim();
    if (!path || !message) continue;
    next[path] = message;
    next[toDotErrorPath(path)] = message;
  }
  return next;
}

export function hasFieldPrefix(fieldErrors: Record<string, string>, prefix: string) {
  return Object.keys(fieldErrors || {}).some((path) => path.startsWith(prefix));
}

function toBracketErrorPath(path: string) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  return raw.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
}

function toDotErrorPath(path: string) {
  return String(path || '').replace(/\[(\d+)\]/g, '.$1');
}
