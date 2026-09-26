export interface SecurityConfig {
  maxUploadBytes: number;
  maxStoragePerUserBytes: number;
  loginRateLimit: number;
  uploadRateLimit: number;
  maxRepositories: number;
  allowedExtensions: string[];
}

const DEFAULT_ALLOWED_EXTENSIONS = [
  'py', 'ipynb', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'cs',
  'go', 'rs', 'swift', 'php', 'rb', 'r', 'scala', 'sql', 'html', 'css',
  'scss', 'json', 'yaml', 'yml', 'xml', 'md', 'txt', 'csv', 'parquet',
  'feather', 'pkl', 'joblib', 'onnx', 'pt', 'pth', 'keras', 'h5',
  'env', 'sh', 'bat', 'ps1', 'toml', 'ini', 'cfg', 'conf', 'log', 'dockerfile',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'tex',
];

function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseListEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;

  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function getSecurityConfig(): SecurityConfig {
  return {
    maxUploadBytes: parseNumberEnv('MAX_UPLOAD_SIZE', 25 * 1024 * 1024),
    maxStoragePerUserBytes: parseNumberEnv('MAX_STORAGE_PER_USER', 100 * 1024 * 1024),
    loginRateLimit: parseNumberEnv('LOGIN_RATE_LIMIT', 10),
    uploadRateLimit: parseNumberEnv('UPLOADS_PER_MINUTE', 20),
    maxRepositories: parseNumberEnv('MAX_REPOSITORIES', 50),
    allowedExtensions: parseListEnv('ALLOWED_FILE_TYPES', DEFAULT_ALLOWED_EXTENSIONS),
  };
}

export async function getDynamicSecurityConfig(db: any, userId?: string): Promise<SecurityConfig> {
  const { siteSettings, users } = await import('../db/schema.js');
  const { eq } = await import('drizzle-orm');
  
  const baseConfig = getSecurityConfig();
  let finalExtensions = [...baseConfig.allowedExtensions];

  try {
    const [globalSetting] = await db.select().from(siteSettings).where(eq(siteSettings.key, 'config.append_file_types')).limit(1);
    if (globalSetting && globalSetting.value) {
      const globals = globalSetting.value.split(',').map((v: string) => v.trim().toLowerCase()).filter(Boolean);
      finalExtensions.push(...globals);
    }

    if (userId) {
      const [user] = await db.select({ allowedExtensions: users.allowedExtensions }).from(users).where(eq(users.clerkId, userId)).limit(1);
      if (user && user.allowedExtensions) {
        const userExts = user.allowedExtensions.split(',').map((v: string) => v.trim().toLowerCase()).filter(Boolean);
        finalExtensions.push(...userExts);
      }
    }
  } catch (e) {
    console.warn('[ConfigService] Failed to load dynamic configuration from DB:', e);
  }

  return {
    ...baseConfig,
    allowedExtensions: Array.from(new Set(finalExtensions)),
  };
}
