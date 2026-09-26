import { clerkMiddleware } from "@clerk/astro/server";

const isDevBypass = process.env.ENV === 'development';

const DEV_IDENTITIES = {
  devadmin: {
    userId: process.env.ADMIN_USER_ID || process.env.CLERK_ADMIN_USER_ID || 'mock_dev_admin',
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