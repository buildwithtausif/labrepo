import { createClerkClient, verifyToken } from '@clerk/backend';
import fp from 'fastify-plugin';
export const clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
});
const DEV_ADMIN_ID = process.env.ADMIN_USER_ID || process.env.CLERK_ADMIN_USER_ID || 'mock_dev_admin';
const DEV_TEST_USER_ID = 'mock_test_user';
/**
 * Clerk authentication plugin for Fastify.
 * Verifies JWT from the Authorization header and decorates the request with userId.
 */
async function clerkAuthPlugin(fastify) {
    fastify.decorateRequest('userId', '');
    fastify.addHook('preHandler', async (request, reply) => {
        // Skip auth for health check
        if (request.url === '/health')
            return;
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            if (process.env.ENV === 'development') {
                // Read dev role from cookie forwarded by the frontend
                const cookieHeader = request.headers.cookie || '';
                const match = cookieHeader.match(/devmode_role=(devadmin|testuser)/);
                const role = match?.[1] || 'devadmin';
                request.userId = role === 'testuser' ? DEV_TEST_USER_ID : DEV_ADMIN_ID;
                return;
            }
            return reply.status(401).send({ error: 'Authentication required' });
        }
        const token = authHeader.substring(7);
        try {
            if (process.env.ENV === 'development') {
                // In dev mode, still check the cookie even if a token is present
                const cookieHeader = request.headers.cookie || '';
                const match = cookieHeader.match(/devmode_role=(devadmin|testuser)/);
                const role = match?.[1] || 'devadmin';
                request.userId = role === 'testuser' ? DEV_TEST_USER_ID : DEV_ADMIN_ID;
                return;
            }
            const payload = await verifyToken(token, {
                secretKey: process.env.CLERK_SECRET_KEY,
            });
            if (!payload.sub) {
                return reply.status(401).send({ error: 'Invalid token: no subject' });
            }
            request.userId = payload.sub;
        }
        catch (err) {
            console.error('[clerkAuth] Token verification failed:', err);
            return reply.status(401).send({ error: 'Invalid or expired token', details: err.message });
        }
    });
}
export const clerkAuth = fp(clerkAuthPlugin);
