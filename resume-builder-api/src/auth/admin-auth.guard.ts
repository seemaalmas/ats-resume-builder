import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type AuthUser = {
  userId?: string;
  email?: string;
  mobile?: string;
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
    if (adminEmails.size) {
      const userEmail = String(req.user?.email || '').trim().toLowerCase();
      if (userEmail && adminEmails.has(userEmail)) return true;
    }

    const adminMobiles = parseMobileSet(process.env.ADMIN_MOBILES);

    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, mobile: true },
    });
    if (!row) return false;

    const userEmail = String(row.email || '').trim().toLowerCase();
    if (userEmail && adminEmails.has(userEmail)) return true;

    if (!adminMobiles.size) return false;

    const userMobile = normalizeMobile(row.mobile ?? undefined);
    return Boolean(userMobile && adminMobiles.has(userMobile));
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

function parseMobileSet(value?: string) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => normalizeMobile(item))
      .filter(Boolean),
  );
}

function normalizeMobile(input?: string) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  return `+${digits}`;
}
