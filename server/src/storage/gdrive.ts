import { google, type drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { Readable } from "stream";
import type { StorageAdapter } from "./adapter.js";

/**
 * Escape single quotes in values interpolated into Google Drive query strings
 * to prevent query injection.
 */
function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Per-user Google Drive storage adapter.
 *
 * Each instance is scoped to a single user's Google Drive via their
 * OAuth2 credentials. The server never owns the data — the user does.
 */
export class GoogleDriveStorageAdapter implements StorageAdapter {
  private drive: drive_v3.Drive;
  private rootFolderId: string | null = null;

  constructor(oauth2Client: OAuth2Client) {
    this.drive = google.drive({ version: "v3", auth: oauth2Client });
  }

  async initBucket(): Promise<void> {
    const folderExists = await this.drive.files.list({
      q: "name='labrepo' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: "files(id, name)",
    });

    if (!folderExists.data.files || folderExists.data.files.length === 0) {
      const response = await this.drive.files.create({
        requestBody: {
          name: "labrepo",
          mimeType: "application/vnd.google-apps.folder",
        },
        fields: "id",
      });
      this.rootFolderId = response.data.id || null;
    } else {
      this.rootFolderId = folderExists.data.files[0].id || null;
    }
  }

  private async ensureRoot(): Promise<void> {
    if (!this.rootFolderId) await this.initBucket();
  }

  private async getFileId(key: string): Promise<string | null> {
    await this.ensureRoot();
    const escapedKey = escapeQuery(key);
    const escapedFolderId = escapeQuery(this.rootFolderId!);
    const response = await this.drive.files.list({
      q: `name='${escapedKey}' and trashed=false and '${escapedFolderId}' in parents`,
      fields: "files(id)",
    });
    const files = response.data.files || [];
    return files.length > 0 ? files[0].id! : null;
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.ensureRoot();
    const stream = Readable.from(data);
    const existingId = await this.getFileId(key);

    if (existingId) {
      await this.drive.files.update({
        fileId: existingId,
        media: { mimeType: contentType, body: stream },
      });
    } else {
      await this.drive.files.create({
        requestBody: {
          name: key,
          parents: [this.rootFolderId!],
        },
        media: { mimeType: contentType, body: stream },
      });
    }
  }

  async download(key: string): Promise<{ data: Buffer; contentType: string }> {
    const fileId = await this.getFileId(key);
    if (!fileId) throw new Error(`File not found: ${key}`);

    // Parallel fetch: content + metadata
    const [contentResponse, metaResponse] = await Promise.all([
      this.drive.files.get(
        { fileId, alt: "media" },
        { responseType: "arraybuffer" }
      ),
      this.drive.files.get({ fileId, fields: "mimeType" }),
    ]);

    return {
      data: Buffer.from(contentResponse.data as ArrayBuffer),
      contentType: metaResponse.data.mimeType || "application/octet-stream",
    };
  }

  async delete(key: string): Promise<void> {
    const fileId = await this.getFileId(key);
    if (fileId) {
      await this.drive.files.delete({ fileId });
    }
  }

  async exists(key: string): Promise<boolean> {
    const fileId = await this.getFileId(key);
    return fileId !== null;
  }

  async list(prefix: string): Promise<string[]> {
    await this.ensureRoot();
    const escapedFolderId = escapeQuery(this.rootFolderId!);
    const allNames: string[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const params: drive_v3.Params$Resource$Files$List = {
        q: `trashed=false and '${escapedFolderId}' in parents`,
        fields: "nextPageToken, files(name)",
        pageSize: 1000,
        pageToken,
      };
      const response = await this.drive.files.list(params);

      const files = response.data.files || [];
      for (const f of files) {
        const name = f.name || "";
        if (name.startsWith(prefix)) {
          allNames.push(name);
        }
      }
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return allNames;
  }
}
