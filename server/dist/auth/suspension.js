import { eq } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { getDb } from '../db/runtime.js';
export async function requireNotSuspendedMiddleware(req, res, next) {
    const db = getDb();
    const userId = req.userId;
    if (!userId) {
        next();
        return;
    }
    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.clerkId, userId))
        .limit(1);
    if (user?.uploadsSuspended) {
        res.status(403).json({
            error: 'Your account has been suspended by an administrator. You cannot perform this action.',
        });
        return;
    }
    next();
}
