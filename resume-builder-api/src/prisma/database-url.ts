export type DatabaseConnectionInfo = {
  protocol: 'postgres:' | 'postgresql:';
  host: string;
  port: number;
  database: string;
  sslmode?: string;
  connectionLimit?: number;
  poolTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
};

type PrismaPoolTuning = {
  connectionLimit?: number;
  poolTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
};

export function resolvePrismaDatabaseUrl(value: string | undefined, tuning: PrismaPoolTuning = {}) {
  const parsed = parseDatabaseUrlOrThrow(value);
  const params = parsed.searchParams;

  if (parsed.hostname.includes('supabase.co') && !params.get('sslmode')) {
    params.set('sslmode', 'require');
  }
  applyNumericParamIfMissing(params, 'connection_limit', tuning.connectionLimit);
  applyNumericParamIfMissing(params, 'pool_timeout', tuning.poolTimeoutSeconds);
  applyNumericParamIfMissing(params, 'connect_timeout', tuning.connectTimeoutSeconds);

  return parsed.toString();
}

export function validateDatabaseUrlOrThrow(value: string | undefined): DatabaseConnectionInfo {
  const parsed = parseDatabaseUrlOrThrow(value);
  const protocol = parsed.protocol.toLowerCase();

  const host = parsed.hostname || 'unknown';
  const port = Number(parsed.port || '5432');
  const database = parsed.pathname.replace(/^\//, '') || '(default)';
  const sslmode = parsed.searchParams.get('sslmode') || undefined;
  const connectionLimit = parsePositiveInt(parsed.searchParams.get('connection_limit'));
  const poolTimeoutSeconds = parsePositiveInt(parsed.searchParams.get('pool_timeout'));
  const connectTimeoutSeconds = parsePositiveInt(parsed.searchParams.get('connect_timeout'));

  return {
    protocol: protocol as DatabaseConnectionInfo['protocol'],
    host,
    port,
    database,
    sslmode,
    connectionLimit,
    poolTimeoutSeconds,
    connectTimeoutSeconds,
  };
}

export function buildConnectionErrorMessage(info: DatabaseConnectionInfo, error: unknown): string {
  const base = `Prisma database connection failed (host=${info.host}, port=${info.port}, db=${info.database}).`;
  const detail = error instanceof Error ? error.message : String(error || 'Unknown error');
  const hints: string[] = [];

  if (/P1001/i.test(detail)) {
    hints.push('P1001 indicates the database server is unreachable from this environment.');
  }
  if (/P2024/i.test(detail)) {
    const limit = info.connectionLimit ?? 25;
    const timeout = info.poolTimeoutSeconds ?? 10;
    hints.push(
      `P2024 indicates the Prisma pool was exhausted (connection_limit=${limit}, pool_timeout=${timeout}s).`,
    );
    hints.push('Tune PRISMA_CONNECTION_LIMIT / PRISMA_POOL_TIMEOUT_SECONDS or reduce request bursts.');
  }
  if (info.host.includes('supabase.co') && !info.sslmode) {
    hints.push('For Supabase, add `?sslmode=require` to DATABASE_URL if SSL is required.');
  }

  return [base, detail, ...hints].filter(Boolean).join(' ');
}

function parseDatabaseUrlOrThrow(value: string | undefined) {
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

  return parsed;
}

function applyNumericParamIfMissing(params: URLSearchParams, key: string, value: number | undefined) {
  if (params.get(key)) return;
  if (!Number.isFinite(value) || Number(value) <= 0) return;
  params.set(key, String(Math.floor(Number(value))));
}

function parsePositiveInt(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}
