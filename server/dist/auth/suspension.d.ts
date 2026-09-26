import type { FastifyReply, FastifyRequest } from 'fastify';
/**
 * Checks if the current user is suspended.
 * If suspended, sends a 403 Forbidden response and returns true.
 * If not suspended, returns false.
 */
export declare function requireNotSuspended(request: FastifyRequest, reply: FastifyReply): Promise<boolean>;
