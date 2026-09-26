import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Placeholder secrets that are safe for local development only.
 * They are rejected by the schema when NODE_ENV=production.
 */
export const DEV_ACCESS_SECRET = 'easytube_dev_access_secret_change_me_32ch';
export const DEV_REFRESH_SECRET = 'easytube_dev_refresh_secret_change_me_32ch';

/**
 * Walks up from the current working directory looking for a `.env` file so the
 * server boots correctly whether it is started from the monorepo root, the
 * `server` workspace, or a compiled `dist` entrypoint on a VPS.
 */
function findEnvFile(startDir: string, maxDepth = 6): string | undefined {
  let current = path.resolve(startDir);

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const candidate = path.join(current, '.env');
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return undefined;
}

const envFilePath = findEnvFile(process.cwd());
if (envFilePath) {
  dotenv.config({ path: envFilePath });
}

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    HOST: z.string().min(1).default('0.0.0.0'),
    API_PREFIX: z
      .string()
      .regex(/^\/[a-zA-Z0-9/_-]*$/, 'API_PREFIX must start with "/" and contain URL-safe characters')
      .default('/api/v1'),
    APP_NAME: z.string().min(1).default('easytube-api'),
    APP_VERSION: z.string().min(1).default('0.1.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    BODY_LIMIT: z.string().min(2).default('1mb'),

    CLIENT_URL: z.string().default('http://localhost:5173'),
    CORS_ORIGINS: z.string().optional(),

    MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/easytube'),
    MONGO_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(1_000).default(10),
    MONGO_MIN_POOL_SIZE: z.coerce.number().int().min(0).max(1_000).default(0),
    MONGO_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
    MONGO_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(45_000),
    MONGO_CONNECT_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    MONGO_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(1_000),
    /**
     * When false the API still boots if a datastore is unreachable and simply
     * reports itself as not-ready, which keeps `npm run dev` usable before
     * Docker is up. The schema below refuses to boot a production instance
     * without it, because such an instance cannot serve real traffic.
     */
    REQUIRE_DATABASES_ON_BOOT: booleanish,

    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
    REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
    REDIS_MAX_RETRIES_PER_REQUEST: z.coerce.number().int().min(0).default(3),
    REDIS_KEY_PREFIX: z.string().default('easytube:'),

    JWT_ACCESS_SECRET: z.string().min(32).default(DEV_ACCESS_SECRET),
    JWT_REFRESH_SECRET: z.string().min(32).default(DEV_REFRESH_SECRET),
    JWT_ACCESS_TTL: z.string().min(2).default('15m'),
    JWT_REFRESH_TTL: z.string().min(2).default('7d'),
    COOKIE_DOMAIN: z.string().optional(),
    /**
     * `lax` is right for a same-origin deployment. A client served from a
     * different origin needs `none`, which browsers only accept alongside
     * `Secure`; that is enforced below rather than discovered at runtime.
     */
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    /**
     * Defaults on in production. Left off in development so cookies work over
     * plain http on a LAN, at the cost of allowing them over http.
     */
    COOKIE_SECURE: booleanish.optional(),
    /** Verified on every token, so a token minted for another service is rejected. */
    JWT_ISSUER: z.string().min(1).default('easytube-api'),
    JWT_AUDIENCE: z.string().min(1).default('easytube-client'),
    /**
     * Mixed into every password before hashing. A leaked database dump is then
     * useless on its own: the attacker also needs this value, which never
     * leaves the application. Changing it invalidates every stored hash, so it
     * is treated as a permanent, not rotated, secret.
     */
    AUTH_PEPPER: z.string().default(''),
    /**
     * Brute-force damping. After this many consecutive failures an account is
     * refused for `AUTH_LOCKOUT_MINUTES`, which turns an online guessing attack
     * from millions of attempts per hour into a handful per day.
     */
    AUTH_MAX_FAILED_LOGINS: z.coerce.number().int().min(1).max(100).default(10),
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1_440).default(15),
    /**
     * Argon2id cost. Defaults are deliberately conservative; raise on real
     * hardware after measuring login latency. The bounds are the library's own:
     * `timeCost` below 2 is rejected at hash time, so it is rejected at boot
     * instead.
     */
    ARGON2_MEMORY_COST_KIB: z.coerce.number().int().min(8_192).max(1_048_576).default(19_456),
    ARGON2_TIME_COST: z.coerce.number().int().min(2).max(10).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(15 * 60 * 1_000),
    RATE_LIMIT_ANALYZE: z.coerce.number().int().min(1).default(30),
    RATE_LIMIT_DOWNLOAD: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_AUTH: z.coerce.number().int().min(1).default(10),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_BUCKET: z.string().default(''),
    STORAGE_REGION: z.string().default(''),
    STORAGE_ENDPOINT: z.string().default(''),
    STORAGE_ACCESS_KEY: z.string().default(''),
    STORAGE_SECRET_KEY: z.string().default(''),
    STORAGE_FORCE_PATH_STYLE: booleanish,
    SIGNED_URL_TTL_MINUTES: z.coerce.number().int().min(1).default(60),
    TEMP_DIR: z.string().default('tmp'),

    FFMPEG_PATH: z.string().default('ffmpeg'),
    FFPROBE_PATH: z.string().default('ffprobe'),
  })
  .superRefine((values, ctx) => {
    if (values.NODE_ENV !== 'production') return;

    const productionGuards: Array<[keyof typeof values, string | undefined]> = [
      ['JWT_ACCESS_SECRET', values.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', values.JWT_REFRESH_SECRET],
    ];

    for (const [key, value] of productionGuards) {
      if (!value || value.startsWith('easytube_dev_')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [String(key)],
          message: `${String(key)} must be set to a unique, high-entropy value in production`,
        });
      }
    }

    // Without a pepper, a leaked dump of the users collection yields hashes that
    // can be attacked offline. The pepper lives in the environment, not the
    // database, so the two have to be stolen separately. It is required in
    // production rather than merely recommended: the failure mode without it is
    // silent, and nothing about the running app would look wrong.
    if (!values.AUTH_PEPPER || values.AUTH_PEPPER.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_PEPPER'],
        message: 'AUTH_PEPPER must be set to at least 32 characters in production',
      });
    }

    if (values.JWT_ACCESS_SECRET === values.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ',
      });
    }

    // A production instance with no database cannot serve traffic, so refusing
    // to boot is safer than silently serving 500s.
    if (!values.REQUIRE_DATABASES_ON_BOOT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REQUIRE_DATABASES_ON_BOOT'],
        message: 'REQUIRE_DATABASES_ON_BOOT must be true in production',
      });
    }

    // Browsers reject `SameSite=None` without `Secure`, so a cross-origin client
    // configured this way would silently receive no cookie at all. Fail at boot
    // with a clear message instead of leaving the developer to guess.
    const secure = values.COOKIE_SECURE ?? values.NODE_ENV === 'production';
    if (values.COOKIE_SAME_SITE === 'none' && !secure) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true when COOKIE_SAME_SITE is "none"',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  // Startup must fail loudly rather than run with a half-valid configuration.
  console.error(`\n[easytube] Invalid environment configuration:\n${details}\n`);
  process.exit(1);
}

const raw = parsed.data;

/**
 * Allowed browser origins. `CLIENT_URL` is always included; `CORS_ORIGINS`
 * adds extra origins (comma separated) for preview deployments.
 */
const allowedOrigins = Array.from(
  new Set([raw.CLIENT_URL, ...csv(raw.CORS_ORIGINS ?? '')].filter((origin) => origin.length > 0)),
);

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  allowedOrigins,
  /** Resolved once here so no call site re-derives the default. */
  cookieSecure: raw.COOKIE_SECURE ?? raw.NODE_ENV === 'production',
} as const;

export type Env = typeof env;
