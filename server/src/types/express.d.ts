/**
 * Express request augmentation.
 *
 * `requestId` is intentionally distinct from pino-http's own `req.id` (typed
 * as `string | number`) so the correlation id stays a plain `string` everywhere
 * in our code. `req.log` is augmented by pino-http itself.
 *
 * `auth` is optional because it is absent on anonymous routes: its presence is
 * what distinguishes "nobody signed in" from "signed in as this user".
 */
import type { RequestAuth } from './auth';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id for this request. Set by the `requestId` middleware. */
      requestId: string;
      /** Set by the `authenticate` middleware. */
      auth?: RequestAuth;
    }
  }
}

export {};
