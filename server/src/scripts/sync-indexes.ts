/**
 * Reconciles MongoDB indexes with the schemas.
 *
 *   npm run db:sync-indexes            # create anything missing, drop nothing
 *   npm run db:sync-indexes -- --drop  # also drop indexes the schema no longer declares
 *
 * The application already runs the safe, additive path at boot, so the default
 * here exists mainly for CI and for the one case the default cannot handle:
 * a renamed index. MongoDB will not create `users_email_unique` on a key that
 * an existing `email_1` already covers, so a rename needs the old index dropped
 * first, and that is a deliberate operator decision rather than something a
 * deploy should do by surprise.
 */
import mongoose from 'mongoose';

import { shouldAutoIndex } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { syncModelIndexes } from '../models';

const drop = process.argv.includes('--drop');

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI, { autoIndex: shouldAutoIndex() });

  const result = await syncModelIndexes({ drop });

  for (const [name, indexes] of Object.entries(result)) {
    logger.info({ model: name, indexes }, drop ? 'Indexes reconciled' : 'Indexes ensured');
  }

  if (drop) {
    logger.warn('Reconciliation complete: indexes absent from the schemas were dropped');
  }

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  logger.error(
    { err: error instanceof Error ? error.message : String(error) },
    'Index sync failed',
  );
  process.exitCode = 1;
  void mongoose.disconnect();
});
