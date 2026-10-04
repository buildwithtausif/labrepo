import type { StorageAdapter } from '../storage/adapter.js';
export type StorageResolverFn = (userId: string) => Promise<StorageAdapter>;
export declare function createFileRoutes(resolveStorage: StorageResolverFn): import("express-serve-static-core").Router;
