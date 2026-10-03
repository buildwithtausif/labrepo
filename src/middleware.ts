import { clerkMiddleware } from "@clerk/astro/server";

import { loadEnv } from "vite";
const env = loadEnv(import.meta.env.MODE, process.cwd(), "");
const isDevBypass = env.ENV?.trim() === 'development';

const ADMIN_USER_ID = env.ADMIN_USER_ID?.trim() || import.meta.env.ADMIN_USER_ID;
const CLERK_ADMIN_USER_ID = env.CLERK_ADMIN_USER_ID?.trim() || import.meta.env.CLERK_ADMIN_USER_ID;

const DEV_IDENTITIES = {
  devadmin: {
    userId: ADMIN_USER_ID || CLERK_ADMIN_USER_ID || 'mock_dev_admin',
    role: 'admin',
  },
  testuser: {
    userId: 'mock_test_user',
    role: 'user',
  },
} as const;

export const onRequest = isDevBypass 
  ? async (context: any, next: any) => {
      // Read the chosen dev identity from cookie (default: devadmin)
      const cookieHeader = context.request.headers.get?.('cookie') || '';
      const match = cookieHeader.match(/devmode_role=(devadmin|testuser)/);
      const role = (match?.[1] || 'devadmin') as keyof typeof DEV_IDENTITIES;
      const identity = DEV_IDENTITIES[role];

      // Mock the auth() object that Clerk usually injects
      context.locals.auth = () => ({
        userId: identity.userId,
        sessionId: 'mock_session',
        getToken: async () => 'mock_token',
      });

      // Expose the dev role for SSR pages to read
      context.locals.devRole = role;

      return next();
    }
  : clerkMiddleware();