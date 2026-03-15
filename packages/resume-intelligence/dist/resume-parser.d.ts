export type ParsedResumeText = {
    lines: string[];
    sections: Record<string, string[]>;
};
export declare function parseResumeText(rawText: string): ParsedResumeText;
export declare function normalizeText(text: string): string;
//# sourceMappingURL=resume-parser.d.ts.map