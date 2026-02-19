export type PlanName = 'FREE' | 'STUDENT' | 'PRO';

export function getPlanConfig(plan: PlanName) {
  switch (plan) {
    case 'STUDENT':
      return { aiTokensLimit: 40000, pdfExportsLimit: 25, atsScansLimit: 50, resumesLimit: 10 };
    case 'PRO':
      return { aiTokensLimit: 120000, pdfExportsLimit: 200, atsScansLimit: 300, resumesLimit: 100 };
    case 'FREE':
    default:
      return { aiTokensLimit: 8000, pdfExportsLimit: 5, atsScansLimit: 2, resumesLimit: 2 };
  }
}
