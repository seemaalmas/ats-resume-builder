import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  status() {
    return { ok: true, status: 'ready' };
  }

  @Get('db')
  async dbStatus() {
    const info = this.prisma.getConnectionInfo();
    try {
      await this.prisma.ping();
      return { ok: true, status: 'ready', db: 'up', host: info.host, port: info.port };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Database ping failed';
      throw new ServiceUnavailableException({
        ok: false,
        status: 'degraded',
        db: 'down',
        host: info.host,
        port: info.port,
        message,
      });
    }
  }
}
