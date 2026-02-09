import { PrismaService } from '../prisma/prisma.service';
import type { PlanName } from './plan-limits';
import { getPlanConfig } from './plan-limits';

export async function resetUsageForPlan(
  prisma: PrismaService,
  userId: string,
  plan: PlanName,
  periodEnd?: Date,
) {
  const now = new Date();
  const end = periodEnd || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const config = getPlanConfig(plan);

  await prisma.user.update({
    where: { id: userId },
    data: {
      aiTokensUsed: 0,
      pdfExportsUsed: 0,
      atsScansUsed: 0,
      aiTokensLimit: config.aiTokensLimit,
      pdfExportsLimit: config.pdfExportsLimit,
      atsScansLimit: config.atsScansLimit,
      resumesLimit: config.resumesLimit,
      usagePeriodStart: now,
      usagePeriodEnd: end,
    },
  });
}

export async function ensureUsagePeriod(
  prisma: PrismaService,
  user: {
    id: string;
    plan: string;
    usagePeriodEnd: Date | null;
    stripeCurrentPeriodEnd: Date | null;
  },
) {
  const now = new Date();
  if (user.usagePeriodEnd && user.usagePeriodEnd.getTime() > now.getTime()) {
    return;
  }
  const plan = (user.plan || 'FREE') as PlanName;
  const periodEnd = user.stripeCurrentPeriodEnd || undefined;
  await resetUsageForPlan(prisma, user.id, plan, periodEnd);
}
