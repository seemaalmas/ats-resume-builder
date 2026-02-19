import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { buildConnectionErrorMessage, type DatabaseConnectionInfo, validateDatabaseUrlOrThrow } from './database-url';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  private connectionInfo: DatabaseConnectionInfo | null = null;

  async onModuleInit() {
    const info = validateDatabaseUrlOrThrow(process.env.DATABASE_URL);
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

  getConnectionInfo() {
    if (this.connectionInfo) return this.connectionInfo;
    return validateDatabaseUrlOrThrow(process.env.DATABASE_URL);
  }

  async ping() {
    await this.$queryRawUnsafe('SELECT 1');
    return { ok: true };
  }
}
