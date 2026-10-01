export interface ValidationResult {
    valid: boolean;
    sanitizedFilename?: string;
    extension?: string;
    contentType?: string;
    reason?: string;
}
export interface ValidationInput {
    filename: string;
    size: number;
    contentType?: string;
    allowedExtensions: Set<string>;
    maxBytes: number;
}
export declare function sanitizeFilename(filename: string): string;
export declare function getExtension(filename: string): string;
export declare function validateUploadCandidate(input: ValidationInput): ValidationResult;
