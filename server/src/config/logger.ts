import pino, { type Logger } from 'pino';

import { env } from './env';

/**
 * Paths that must never reach the log sink. Anything that could carry a
 * credential is redacted defensively even when we believe we do not log it.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.passwordHash',
  'req.body.token',
  'req.body.refreshToken',
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
];

const baseOptions = {
  level: env.LOG_LEVEL,
  base: {
    service: env.APP_NAME,
    env: env.NODE_ENV,
  },
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label: string) => ({ level: label }),
  },
} satisfies pino.LoggerOptions;

/** Pretty output in development, structured NDJSON everywhere else. */
export const logger: Logger =
  env.NODE_ENV === 'development'
    ? pino({
        ...baseOptions,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service,env',
            messageFormat: '{if reqId}[{reqId}] {end}{msg}',
          },
        },
      })
    : pino(baseOptions);

/** Creates a child logger that automatically carries contextual fields. */
export function createLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

export type { Logger };
