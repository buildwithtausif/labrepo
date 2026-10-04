import type { Request, Response, NextFunction } from 'express';
export declare function requireNotSuspendedMiddleware(req: Request, res: Response, next: NextFunction): Promise<void>;
