import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type AuthUser = {
  userId?: string;
  email?: string;
};

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const userId = String(req.user?.userId || '').trim();
    if (!userId) return false;

    const adminUserIds = parseCsvSet(process.env.ADMIN_USER_IDS);
    if (adminUserIds.has(userId)) return true;

    const adminEmails = parseCsvSet(process.env.ADMIN_EMAILS);
    if (!adminEmails.size) return false;

    const userEmail = String(req.user?.email || '').trim().toLowerCase();
    if (userEmail && adminEmails.has(userEmail)) return true;

    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return Boolean(row?.email && adminEmails.has(row.email.toLowerCase()));
  }
}

function parseCsvSet(value?: string) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

