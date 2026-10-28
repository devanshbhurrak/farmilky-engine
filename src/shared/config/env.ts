export type RuntimeKind = 'node' | 'workers';

type EnvSource = Record<string, unknown>;

let envSource: EnvSource = {};
let runtimeKind: RuntimeKind = 'node';

/**
 * Copy Worker bindings (vars + secrets) into the process-wide configuration.
 * Node deployments keep using process.env and do not need to call this.
 */
export function configureEnv(source: EnvSource, options?: { runtime?: RuntimeKind }): void {
  envSource = { ...source };
  if (options?.runtime) runtimeKind = options.runtime;
}

export function resetEnv(): void {
  envSource = {};
  runtimeKind = 'node';
}

function read(key: string): string | undefined {
  const bound = envSource[key];
  if (typeof bound === 'string' && bound.length > 0) return bound;
  if (typeof process !== 'undefined' && process.env) {
    const fromProcess = process.env[key];
    if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  }
  return undefined;
}

export function runtime(): RuntimeKind {
  return runtimeKind;
}

export function isWorkersRuntime(): boolean {
  return runtimeKind === 'workers';
}

const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CRON_SECRET'];

const CRON_SECRET_MIN_LENGTH = 16;

export function validateEnv(): void {
  const missing = required.filter((k) => !read(k));
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);
  const cronSecret = read('CRON_SECRET') ?? '';
  if (cronSecret.length < CRON_SECRET_MIN_LENGTH) {
    throw new Error(
      `CRON_SECRET must be at least ${CRON_SECRET_MIN_LENGTH} characters (fail-fast: refusing to start with a weak/missing cron secret)`,
    );
  }

  const origins = parseOrigins();
  if (origins.includes('*')) {
    throw new Error('ALLOWED_ORIGINS cannot contain "*" while credentials are enabled');
  }
  if (env.nodeEnv === 'production' && origins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must be configured in production');
  }
}

function parseOrigins(): string[] {
  return (read('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export const env = {
  get databaseUrl(): string { return read('DATABASE_URL')!; },
  get redisUrl(): string | undefined { return read('REDIS_URL'); },
  get jwtAccessSecret(): string { return read('JWT_ACCESS_SECRET')!; },
  get jwtRefreshSecret(): string { return read('JWT_REFRESH_SECRET')!; },
  get cronSecret(): string { return read('CRON_SECRET') ?? ''; },
  get port(): number { return Number(read('PORT') ?? 4000); },
  get nodeEnv(): string { return read('NODE_ENV') ?? 'development'; },
  get allowedOrigins(): string[] { return parseOrigins(); },
  get backendUrl(): string { return read('BACKEND_URL') ?? ''; },
  get bcryptRounds(): number { return Number(read('BCRYPT_ROUNDS') ?? 12); },
  get brandPhone(): string { return read('BRAND_PHONE') ?? '9244237975'; },
  get upiId(): string { return read('UPI_ID') ?? ''; },
  get upiName(): string { return read('UPI_NAME') ?? 'Farmilky'; },
  get r2AccountId(): string | undefined { return read('R2_ACCOUNT_ID'); },
  get r2AccessKeyId(): string | undefined { return read('R2_ACCESS_KEY_ID'); },
  get r2SecretAccessKey(): string | undefined { return read('R2_SECRET_ACCESS_KEY'); },
  get r2Endpoint(): string | undefined { return read('R2_ENDPOINT'); },
  get r2BucketName(): string | undefined { return read('R2_BUCKET_NAME'); },
  get r2PublicUrl(): string | undefined { return read('R2_PUBLIC_URL'); },
  get r2KeyPrefix(): string { return read('R2_KEY_PREFIX') ?? 'products'; },
};

export const isProd = (): boolean => env.nodeEnv === 'production';
export const isCrossSite = (): boolean => env.allowedOrigins.some((o) => !o.includes('localhost'));
