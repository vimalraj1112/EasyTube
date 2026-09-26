import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

import { ApiError } from '../utils/ApiError';

const VALIDATION_TARGETS = ['body', 'query', 'params'] as const;
type ValidationTarget = (typeof VALIDATION_TARGETS)[number];

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Builds a middleware that validates and **coerces** the request sections
 * declared in `schemas`, replacing each with its parsed output.
 *
 * Coercion is the point: a query string arrives as text, so a schema such as
 * `z.coerce.number().int()` means controllers receive a real `number` instead of
 * re-parsing it themselves.
 *
 * Note: overwriting `req.query` requires Express 4, where `query` is a writable
 * own property. On Express 5 it becomes a getter and this needs revisiting.
 *
 * Mount this on the route rather than with `app.use()`. A `params` schema is
 * only satisfiable where the route pattern actually declares the parameter
 * (`router.put('/:id', validate({ params }), handler)`), and a `query`/`body`
 * schema applied globally would reject requests to unrelated routes:
 *
 *   router.get('/downloads', validate({ query: paginationSchema }), listDownloads);
 *   router.get('/downloads/:id', validate({ params: idParams }), getDownload);
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  const targets = VALIDATION_TARGETS.filter((target) => schemas[target] !== undefined);

  return (req, _res, next) => {
    const details: Record<string, unknown> = {};
    const failed: ValidationTarget[] = [];
    const writable = req as unknown as Record<string, unknown>;

    for (const target of targets) {
      const schema = schemas[target];
      if (!schema) continue;

      const result = schema.safeParse(req[target]);

      if (result.success) {
        writable[target] = result.data;
      } else {
        // `flatten()` gives { formErrors, fieldErrors } which maps cleanly onto
        // what a form or the client needs to highlight.
        details[target] = result.error.flatten();
        failed.push(target);
      }
    }

    if (failed.length > 0) {
      next(ApiError.validation(`Validation failed for: ${failed.join(', ')}.`, details));
      return;
    }

    next();
  };
}
