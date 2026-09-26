export interface AbuseRuleResult {
    flagged: boolean;
    reason?: string;
    severity?: 'low' | 'medium' | 'high';
}
export declare function evaluateAbuseSignals(input: {
    userId: string;
    action: 'upload' | 'download' | 'login' | 'repository_create';
    ipAddress?: string;
    userAgent?: string;
}): Promise<AbuseRuleResult>;
