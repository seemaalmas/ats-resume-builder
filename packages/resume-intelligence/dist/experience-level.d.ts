import type { ExperienceItem, RoleLevel } from 'resume-schemas';
export type ExperienceSignals = {
    roleCount: number;
    distinctCompanyCount: number;
    rolesWithDateCount: number;
    roleCompanyPatternCount: number;
    estimatedTotalMonths: number;
};
export declare function computeExperienceLevel(input: {
    resumeText: string;
    experience: ExperienceItem[];
}): {
    level: RoleLevel;
    signals: ExperienceSignals;
};
//# sourceMappingURL=experience-level.d.ts.map