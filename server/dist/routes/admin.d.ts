import type { FastifyInstance } from 'fastify';
import type { StorageAdapter } from '../storage/adapter.js';
export declare function createAdminRoutes(storage: StorageAdapter): (fastify: FastifyInstance) => Promise<void>;
