import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { StorageAdapter } from './adapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * MockS3Adapter — emulates S3 using the local filesystem.
 * Files are stored under server/data/storage/{key}.
 * Used during development with fake AWS credentials.
 */
export class MockS3Adapter implements StorageAdapter {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || path.join(__dirname, '..', '..', 'data', 'storage');
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  private resolvePath(key: string): string {
    // Prevent path traversal attacks
    const resolved = path.resolve(this.basePath, key);
    if (!resolved.startsWith(this.basePath)) {
      throw new Error('Invalid storage key: path traversal detected');
    }
    return resolved;
  }

  async upload(key: string, data: Buffer, _contentType: string): Promise<void> {
    const filePath = this.resolvePath(key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Store metadata alongside the file
    fs.writeFileSync(filePath, data);
    fs.writeFileSync(`${filePath}.meta`, JSON.stringify({ contentType: _contentType, size: data.length }));
  }

  async download(key: string): Promise<{ data: Buffer; contentType: string }> {
    const filePath = this.resolvePath(key);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${key}`);
    }

    const data = fs.readFileSync(filePath);
    let contentType = 'application/octet-stream';

    const metaPath = `${filePath}.meta`;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        contentType = meta.contentType || contentType;
      } catch {
        // Ignore meta read errors
      }
    }

    return { data, contentType };
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const metaPath = `${filePath}.meta`;
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    return fs.existsSync(filePath);
  }

  async list(prefix: string): Promise<string[]> {
    const dirPath = this.resolvePath(prefix);
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    const results: string[] = [];

    function walkDir(dir: string, baseKey: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.endsWith('.meta')) continue;
        const entryPath = path.join(dir, entry.name);
        const entryKey = baseKey ? `${baseKey}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walkDir(entryPath, entryKey);
        } else {
          results.push(prefix ? `${prefix}/${entryKey}` : entryKey);
        }
      }
    }

    walkDir(dirPath, '');
    return results;
  }
}
