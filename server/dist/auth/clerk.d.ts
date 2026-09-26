import type { FastifyInstance } from 'fastify';
export declare const clerkClient: import("@clerk/backend").ClerkClient;
declare module 'fastify' {
    interface FastifyRequest {
        userId: string;
    }
}
/**
 * Clerk authentication plugin for Fastify.
 * Verifies JWT from the Authorization header and decorates the request with userId.
 */
declare function clerkAuthPlugin(fastify: FastifyInstance): Promise<void>;
export declare const clerkAuth: typeof clerkAuthPlugin;
export {};
