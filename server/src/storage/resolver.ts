import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { getDb } from "../db/runtime.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { GoogleDriveStorageAdapter } from "./gdrive.js";
import type { StorageAdapter } from "./adapter.js";

/**
 * Creates an OAuth2 client configured with the app's GDrive credentials.
 * This is the base client — call setCredentials() to scope it to a user.
 */
export function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_DRIVE_AUTH_CLIENT_ID,
    process.env.GOOGLE_DRIVE_AUTH_SECRET_KEY,
    process.env.GOOGLE_DRIVE_REDIRECT_URI ||
      `http://localhost:${process.env.API_PORT || 3001}/api/auth/gdrive/callback`
  );
}

/**
 * Creates a per-user Google Drive StorageAdapter using the user's stored
 * refresh token. Returns null if the user hasn't connected their Drive.
 */
export async function getGDriveAdapterForUser(
  userId: string
): Promise<StorageAdapter | null> {
  const db = getDb();
  const [user] = await db
    .select({ refreshToken: users.gdriveRefreshToken })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  if (!user?.refreshToken) return null;

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: user.refreshToken });

  return new GoogleDriveStorageAdapter(oauth2Client);
}

/**
 * Creates a per-user Google Drive StorageAdapter, or throws if not connected.
 * Use this in routes where Drive is required.
 */
export async function requireGDriveAdapter(
  userId: string
): Promise<StorageAdapter> {
  const adapter = await getGDriveAdapterForUser(userId);
  if (!adapter) {
    throw Object.assign(
      new Error("Google Drive not connected. Please connect your Google Drive first."),
      { statusCode: 403 }
    );
  }
  return adapter;
}
