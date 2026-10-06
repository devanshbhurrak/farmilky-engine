const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

export function validateEnv(): void {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);
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
};

export const isProd = (): boolean => env.nodeEnv === 'production';
export const isCrossSite = (): boolean => env.allowedOrigins.some((o) => !o.includes('localhost'));
