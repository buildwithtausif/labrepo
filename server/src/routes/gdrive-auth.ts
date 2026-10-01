import { Router } from "express";
import { getDb } from "../../db/runtime.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { createOAuth2Client } from "../../storage/resolver.js";
import { writeAuditLog } from "../../services/audit.service.js";
import { google } from "googleapis";

export function gdriveAuthRoutes() {
  const router = Router();

  /**
   * GET /api/auth/gdrive — Start the OAuth2 consent flow.
   * Redirects the user to Google's consent screen.
   */
  router.get("/api/auth/gdrive", async (req, res) => {
    const oauth2Client = createOAuth2Client();

    // Store userId in the state param so we can associate it in the callback
    const state = Buffer.from(
      JSON.stringify({ userId: req.userId })
    ).toString("base64url");

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline", // Required to get a refresh_token
      prompt: "consent", // Force consent to always get refresh_token
      scope: ["https://www.googleapis.com/auth/drive.file"],
      state,
    });

    res.redirect(authUrl);
  });

  /**
   * GET /api/auth/gdrive/callback — OAuth2 callback from Google.
   * Exchanges the auth code for tokens, stores the refresh token.
   */
  router.get("/api/auth/gdrive/callback", async (req, res) => {
    const { code, state, error } = req.query as any;

    if (error) {
      res.status(400).json({
        error: `Google Drive authorization failed: ${error}`,
      });
      return;
    }

    if (!code || !state) {
      res.status(400).json({
        error: "Missing authorization code or state parameter",
      });
      return;
    }

    // Decode the state to get the userId
    let userId: string;
    try {
      const decoded = JSON.parse(
        Buffer.from(state, "base64url").toString("utf-8")
      );
      userId = decoded.userId;
    } catch {
      res.status(400).json({ error: "Invalid state parameter" });
      return;
    }

    // Exchange the authorization code for tokens
    const oauth2Client = createOAuth2Client();
    let tokens;
    try {
      const response = await oauth2Client.getToken(code as string);
      tokens = response.tokens;
    } catch (err: any) {
      console.error("[gdrive-auth] Token exchange failed:", err);
      res.status(500).json({
        error: "Failed to exchange authorization code for tokens",
      });
      return;
    }

    if (!tokens.refresh_token) {
      res.status(400).json({
        error:
          "No refresh token received. This can happen if you previously connected. Try revoking LabRepo access in your Google Account settings and reconnecting.",
      });
      return;
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
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: { gdriveEmail },
    });

    // Redirect to frontend success page (or close the popup)
    const frontendUrl = process.env.PUBLIC_SITE_URL || "http://localhost:4321";
    res.redirect(`${frontendUrl}/dashboard?gdrive=connected`);
  });

  /**
   * GET /api/auth/gdrive/status — Check if the current user has connected Drive.
   */
  router.get("/api/auth/gdrive/status", async (req, res) => {
    const db = getDb();
    const [user] = await db
      .select({
        connected: users.gdriveConnectedAt,
        email: users.gdriveEmail,
      })
      .from(users)
      .where(eq(users.clerkId, req.userId))
      .limit(1);

    res.json({
      connected: !!user?.connected,
      gdriveEmail: user?.email || null,
      connectedAt: user?.connected || null,
    });
  });

  /**
   * POST /api/auth/gdrive/disconnect — Remove stored tokens.
   */
  router.post("/api/auth/gdrive/disconnect", async (req, res) => {
    const db = getDb();

    // Optionally revoke the token at Google
    const [user] = await db
      .select({ refreshToken: users.gdriveRefreshToken })
      .from(users)
      .where(eq(users.clerkId, req.userId))
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
      .where(eq(users.clerkId, req.userId));

    await writeAuditLog({
      userId: req.userId,
      action: "gdrive_disconnected",
      resourceType: "storage",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, message: "Google Drive disconnected" });
  });

  return router;
}
