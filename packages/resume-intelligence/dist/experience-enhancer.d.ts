import type { ExperienceItem } from 'resume-schemas';
import type { ParsedResumeText } from './resume-parser.js';
type EnhancerInput = {
    rawText: string;
    parsed?: ParsedResumeText;
    currentExperience: ExperienceItem[];
};
export declare function enhanceExperienceExtraction(input: EnhancerInput): ExperienceItem[];
export declare function extractExperienceFromWorkExperienceSection(rawText: string, parsed?: ParsedResumeText): {
    company: string;
    role: string;
    startDate: string;
    endDate: string;
    highlights: string[];
}[];
export {};
//# sourceMappingURL=experience-enhancer.d.ts.map