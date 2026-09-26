import { logger } from './config/logger';
import { bootstrap } from './bootstrap';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception, exiting');
  process.exit(1);
});

void bootstrap()
  .then((runtime) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        logger.info({ signal }, 'Shutdown signal received');
        void runtime.shutdown(signal).then(() => {
          process.exit(0);
        });
      });
    }
  })
  .catch((error: unknown) => {
    logger.fatal({ err: errorMessage(error) }, 'Failed to start EasyTube API');
    process.exit(1);
  });
