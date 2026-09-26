import { z } from 'zod';

/**
 * Client-side environment contract. Vite inlines `import.meta.env` at build
 * time, so values are validated once, eagerly, with a fail-fast error rather
 * than an `undefined` surfacing deep inside a request.
 */
const clientEnvSchema = z.object({
  /** Relative in dev (Vite proxies /api) and on Vercel; absolute for split hosts. */
  VITE_API_BASE_URL: z.string().min(1).default('/api/v1'),
  VITE_API_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  VITE_HEALTH_POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).default(30_000),
  VITE_APP_NAME: z.string().min(1).default('EasyTube'),
});

const parsed = clientEnvSchema.safeParse(import.meta.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`[easytube] Invalid client environment configuration:\n${details}`);
}

export const clientEnv = parsed.data;
