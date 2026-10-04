import type { StorageAdapter } from '../storage/adapter.js';
import type { StorageResolverFn } from './files.js';
export declare function createAdminRoutes(resolveStorage: StorageResolverFn, fallbackStorage: StorageAdapter): import("express-serve-static-core").Router;
