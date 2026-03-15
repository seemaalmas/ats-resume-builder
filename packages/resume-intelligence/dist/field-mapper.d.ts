import type { ParsedResume } from 'resume-schemas';
import type { ParsedResumeText } from './resume-parser.js';
export type MappedResumeResult = ParsedResume & {
    signals: {
        roleCount: number;
        distinctCompanyCount: number;
        rolesWithDateCount: number;
        roleCompanyPatternCount: number;
        estimatedTotalMonths: number;
    };
};
export declare function mapParsedResume(parsed: ParsedResumeText): MappedResumeResult;
//# sourceMappingURL=field-mapper.d.ts.map