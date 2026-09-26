import type { FastifyInstance } from "fastify";
import { getDb } from "../db/runtime.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { createOAuth2Client } from "../storage/resolver.js";
import { writeAuditLog } from "../services/audit.service.js";
import { google } from "googleapis";

/**
 * Google Drive OAuth2 routes.
 *
 * Flow:
 * 1. Frontend opens /api/auth/gdrive → redirects to Google consent screen
 * 2. User approves → Google redirects to /api/auth/gdrive/callback
 * 3. Callback exchanges code for tokens, stores refresh_token in DB
 * 4. All subsequent storage calls use that user's token
 */
export async function gdriveAuthRoutes(
  fastify: FastifyInstance
): Promise<void> {
  /**
   * GET /api/auth/gdrive — Start the OAuth2 consent flow.
   * Redirects the user to Google's consent screen.
   */
  fastify.get("/api/auth/gdrive", async (request, reply) => {
    const oauth2Client = createOAuth2Client();

    // Store userId in the state param so we can associate it in the callback
    const state = Buffer.from(
      JSON.stringify({ userId: request.userId })
    ).toString("base64url");

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline", // Required to get a refresh_token
      prompt: "consent", // Force consent to always get refresh_token
      scope: ["https://www.googleapis.com/auth/drive.file"],
      state,
    });

    return reply.redirect(authUrl);
  });

  /**
   * GET /api/auth/gdrive/callback — OAuth2 callback from Google.
   * Exchanges the auth code for tokens, stores the refresh token.
   */
  fastify.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/api/auth/gdrive/callback", async (request, reply) => {
    const { code, state, error } = request.query;

    if (error) {
      return reply.status(400).send({
        error: `Google Drive authorization failed: ${error}`,
      });
    }

    if (!code || !state) {
      return reply.status(400).send({
        error: "Missing authorization code or state parameter",
      });
    }

    // Decode the state to get the userId
    let userId: string;
    try {
      const decoded = JSON.parse(
        Buffer.from(state, "base64url").toString("utf-8")
      );
      userId = decoded.userId;
    } catch {
      return reply
        .status(400)
        .send({ error: "Invalid state parameter" });
    }

    // Exchange the authorization code for tokens
    const oauth2Client = createOAuth2Client();
    let tokens;
    try {
      const response = await oauth2Client.getToken(code);
      tokens = response.tokens;
    } catch (err: any) {
      console.error("[gdrive-auth] Token exchange failed:", err);
      return reply.status(500).send({
        error: "Failed to exchange authorization code for tokens",
      });
    }

    if (!tokens.refresh_token) {
      return reply.status(400).send({
        error:
          "No refresh token received. This can happen if you previously connected. Try revoking LabRepo access in your Google Account settings and reconnecting.",
      });
    }

    // Get the user's Google email for display
    let gdriveEmail = "unknown";
    try {
      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      gdriveEmail = userInfo.data.email || "unknown";
    } catch {
      // Non-fatal — we still have the tokens
    }

    // Store the refresh token in the DB
    const db = getDb();
    await db
      .update(users)
      .set({
        gdriveRefreshToken: tokens.refresh_token,
        gdriveConnectedAt: new Date().toISOString(),
        gdriveEmail,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.clerkId, userId));

    await writeAuditLog({
      userId,
      action: "gdrive_connected",
      resourceType: "storage",
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
      metadata: { gdriveEmail },
    });

    // Redirect to frontend success page (or close the popup)
    const frontendUrl = process.env.PUBLIC_SITE_URL || "http://localhost:4321";
    return reply.redirect(
      `${frontendUrl}/dashboard?gdrive=connected`
    );
  });

  /**
   * GET /api/auth/gdrive/status — Check if the current user has connected Drive.
   */
  fastify.get("/api/auth/gdrive/status", async (request) => {
    const db = getDb();
    const [user] = await db
      .select({
        connected: users.gdriveConnectedAt,
        email: users.gdriveEmail,
      })
      .from(users)
      .where(eq(users.clerkId, request.userId))
      .limit(1);

    return {
      connected: !!user?.connected,
      gdriveEmail: user?.email || null,
      connectedAt: user?.connected || null,
    };
  });

  /**
   * POST /api/auth/gdrive/disconnect — Remove stored tokens.
   */
  fastify.post("/api/auth/gdrive/disconnect", async (request) => {
    const db = getDb();

    // Optionally revoke the token at Google
    const [user] = await db
      .select({ refreshToken: users.gdriveRefreshToken })
      .from(users)
      .where(eq(users.clerkId, request.userId))
      .limit(1);

    if (user?.refreshToken) {
      try {
        const oauth2Client = createOAuth2Client();
        await oauth2Client.revokeToken(user.refreshToken);
      } catch {
        // Non-fatal — token might already be invalid
      }
    }

    await db
      .update(users)
      .set({
        gdriveRefreshToken: null,
        gdriveConnectedAt: null,
        gdriveEmail: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.clerkId, request.userId));

    await writeAuditLog({
      userId: request.userId,
      action: "gdrive_disconnected",
      resourceType: "storage",
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    return { success: true, message: "Google Drive disconnected" };
  });
}
