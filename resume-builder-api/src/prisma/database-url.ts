export type DatabaseConnectionInfo = {
  protocol: 'postgres:' | 'postgresql:';
  host: string;
  port: number;
  database: string;
  sslmode?: string;
};

export function validateDatabaseUrlOrThrow(value: string | undefined): DatabaseConnectionInfo {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new Error(
      'DATABASE_URL is missing. Expected format: postgresql://USER:PASSWORD@HOST:5432/DB?schema=public',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      'DATABASE_URL is invalid. Expected format: postgresql://USER:PASSWORD@HOST:5432/DB?schema=public',
    );
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'prisma:') {
    throw new Error(
      'DATABASE_URL must be postgresql://... Do not use prisma:// unless using Prisma Accelerate.',
    );
  }
  if (protocol !== 'postgresql:' && protocol !== 'postgres:') {
    throw new Error(
      `DATABASE_URL must start with postgresql:// or postgres://. Received: ${parsed.protocol}`,
    );
  }

  const host = parsed.hostname || 'unknown';
  const port = Number(parsed.port || '5432');
  const database = parsed.pathname.replace(/^\//, '') || '(default)';
  const sslmode = parsed.searchParams.get('sslmode') || undefined;

  return {
    protocol: protocol as DatabaseConnectionInfo['protocol'],
    host,
    port,
    database,
    sslmode,
  };
}

export function buildConnectionErrorMessage(info: DatabaseConnectionInfo, error: unknown): string {
  const base = `Prisma database connection failed (host=${info.host}, port=${info.port}, db=${info.database}).`;
  const detail = error instanceof Error ? error.message : String(error || 'Unknown error');
  const hints: string[] = [];

  if (/P1001/i.test(detail)) {
    hints.push('P1001 indicates the database server is unreachable from this environment.');
  }
  if (info.host.includes('supabase.co') && !info.sslmode) {
    hints.push('For Supabase, add `?sslmode=require` to DATABASE_URL if SSL is required.');
  }

  return [base, detail, ...hints].filter(Boolean).join(' ');
}

