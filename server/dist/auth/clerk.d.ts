import type { Request, Response, NextFunction } from 'express';
export declare const clerkClient: import("@clerk/backend").ClerkClient;
export declare const clerkAuthMiddleware: (req: Request, res: Response, next: NextFunction) => Promise<void>;
