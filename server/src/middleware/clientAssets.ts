import fs from 'node:fs';
import path from 'node:path';

import express, {
  type Application,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Serves the built client from the API process, so both live on one origin.
 *
 * This is what makes the auth flow survive a page reload. The double-submit CSRF
 * cookie is set without `httpOnly` precisely so the client can read it
 * (`sessionStore.readCsrfCookie`), but script on a page can only read cookies
 * for its own origin. On a split-host deployment - Vercel for the client,
 * Render for the API - that cookie belongs to the API domain, so the client
 * falls back to its in-memory copy and a reload starts out anonymous. Serving
 * both from one origin removes the problem instead of working around it.
 *
 * Ordering matters and is asserted by tests: API routes, then static assets,
 * then the SPA shell, then the JSON 404. The shell must not catch an unknown
 * `/api/...` path, because a mistyped endpoint returning HTML instead of the
 * documented JSON error envelope is far harder to debug than a 404.
 */
export interface ClientAssetOptions {
  /** Absolute path to the built client. Defaults to `env.CLIENT_DIST_DIR`. */
  distDir?: string;
  /** Path prefix that must stay JSON-only. Defaults to `env.API_PREFIX`. */
  apiPrefix?: string;
}

/** Resolves the client build directory, or null when it is not usable. */
export function resolveClientDist(distDir?: string): string | null {
  const target = path.resolve(distDir ?? env.CLIENT_DIST_DIR);
  const indexFile = path.join(target, 'index.html');

  if (!fs.existsSync(indexFile)) {
    logger.warn(
      { distDir: target },
      'SERVE_CLIENT is on but no client build was found; serving the API only',
    );
    return null;
  }

  return target;
}

/**
 * True for requests that must keep returning JSON.
 *
 * Covers the API prefix itself, anything beneath it, and the root health route.
 * The trailing-slash form matters: without it `/api/v1` would fall through to
 * the shell while `/api/v1/health` did not.
 */
export function isApiRequest(pathname: string, apiPrefix: string): boolean {
  return pathname === apiPrefix || pathname.startsWith(`${apiPrefix}/`);
}

/**
 * Mounts static assets and the SPA fallback on an app.
 *
 * Returns null when there is no client build to serve, so the caller can skip
 * the middleware entirely rather than registering a handler that 404s every
 * route and masks the real `notFoundHandler` behind a confusing shell.
 */
export function serveClient(app: Application, options: ClientAssetOptions = {}): boolean {
  const distDir = resolveClientDist(options.distDir);
  if (!distDir) {
    return false;
  }

  const apiPrefix = options.apiPrefix ?? env.API_PREFIX;

  // Hashed filenames are immutable, so they can be cached indefinitely.
  // `index.html` is excluded: it names the current asset hashes, so a stale
  // copy pins the browser to a bundle that no longer exists.
  app.use(
    express.static(distDir, {
      index: false,
      maxAge: '1y',
      immutable: true,
      setHeaders: (res, filePath) => {
        if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  const shell: RequestHandler = (req: Request, res: Response, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    if (isApiRequest(req.path, apiPrefix)) {
      next();
      return;
    }

    // The shell bypasses `express.static`, so the uncacheable rule has to be
    // restated here. It names the current asset hashes, so a cached copy pins
    // the browser to a bundle that a later deploy has already replaced.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  };

  app.get('*', shell);

  logger.info({ distDir }, 'Serving the client build from the API');

  return true;
}
