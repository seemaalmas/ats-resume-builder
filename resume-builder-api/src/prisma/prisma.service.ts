import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  buildConnectionErrorMessage,
  type DatabaseConnectionInfo,
  resolvePrismaDatabaseUrl,
  validateDatabaseUrlOrThrow,
} from './database-url';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private connectionInfo: DatabaseConnectionInfo | null = null;
  private readonly databaseUrl: string;

  constructor() {
    const rawDatabaseUrl = String(process.env.DATABASE_URL || '').trim();
    const databaseUrl = safeResolvePrismaDatabaseUrl(rawDatabaseUrl, {
      connectionLimit: readPositiveInt(process.env.PRISMA_CONNECTION_LIMIT),
      poolTimeoutSeconds: readPositiveInt(process.env.PRISMA_POOL_TIMEOUT_SECONDS),
      connectTimeoutSeconds: readPositiveInt(process.env.PRISMA_CONNECT_TIMEOUT_SECONDS),
    });
    super(
      databaseUrl
        ? {
            datasources: {
              db: {
                url: databaseUrl,
              },
            },
          }
        : undefined,
    );
    this.databaseUrl = databaseUrl;
  }

  async onModuleInit() {
    const info = validateDatabaseUrlOrThrow(this.databaseUrl);
    this.connectionInfo = info;
    try {
      await this.$connect();
      await this.ping();
    } catch (error: unknown) {
      const message = buildConnectionErrorMessage(info, error);
      this.logger.error(message);
      throw new Error(message);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  getConnectionInfo() {
    if (this.connectionInfo) return this.connectionInfo;
    return validateDatabaseUrlOrThrow(this.databaseUrl);
  }

  async ping() {
    await this.$queryRawUnsafe('SELECT 1');
    return { ok: true };
  }
}

function readPositiveInt(value: string | undefined) {
  const parsed = Number(String(value || '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function safeResolvePrismaDatabaseUrl(rawDatabaseUrl: string, tuning: {
  connectionLimit?: number;
  poolTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
}) {
  if (!rawDatabaseUrl) return rawDatabaseUrl;
  try {
    return resolvePrismaDatabaseUrl(rawDatabaseUrl, tuning);
  } catch {
    return rawDatabaseUrl;
  }
}
