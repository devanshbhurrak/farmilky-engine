const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CRON_SECRET'];

const CRON_SECRET_MIN_LENGTH = 16;

export function validateEnv(): void {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (cronSecret.length < CRON_SECRET_MIN_LENGTH) {
    throw new Error(
      `CRON_SECRET must be at least ${CRON_SECRET_MIN_LENGTH} characters (fail-fast: refusing to start with a weak/missing cron secret)`,
    );
  }
}

function parseOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export const env = {
  get databaseUrl(): string { return process.env.DATABASE_URL!; },
  get redisUrl(): string | undefined { return process.env.REDIS_URL || undefined; },
  get jwtAccessSecret(): string { return process.env.JWT_ACCESS_SECRET!; },
  get jwtRefreshSecret(): string { return process.env.JWT_REFRESH_SECRET!; },
  get cronSecret(): string { return process.env.CRON_SECRET ?? ''; },
  get port(): number { return Number(process.env.PORT ?? 4000); },
  get nodeEnv(): string { return process.env.NODE_ENV ?? 'development'; },
  get allowedOrigins(): string[] { return parseOrigins(); },
  get backendUrl(): string { return process.env.BACKEND_URL ?? ''; },
  get bcryptRounds(): number { return Number(process.env.BCRYPT_ROUNDS ?? 12); },
  get r2AccountId(): string | undefined { return process.env.R2_ACCOUNT_ID || undefined; },
  get r2AccessKeyId(): string | undefined { return process.env.R2_ACCESS_KEY_ID || undefined; },
  get r2SecretAccessKey(): string | undefined { return process.env.R2_SECRET_ACCESS_KEY || undefined; },
  get r2BucketName(): string | undefined { return process.env.R2_BUCKET_NAME || undefined; },
  get r2PublicUrl(): string | undefined { return process.env.R2_PUBLIC_URL || undefined; },
};

export const isProd = (): boolean => env.nodeEnv === 'production';
export const isCrossSite = (): boolean => env.allowedOrigins.some((o) => !o.includes('localhost'));
