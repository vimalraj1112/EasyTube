import argon2 from 'argon2';

import { env } from '../config/env';

/**
 * Password hashing.
 *
 * argon2id rather than bcrypt or scrypt: it is the current recommendation, and
 * the memory-hard construction is what makes a GPU or FPGA rig useless for
 * offline cracking. bcrypt remains a respectable choice, but argon2id is
 * strictly better on the axis that matters here.
 *
 * Every hash embeds its own parameters, so raising the cost later does not
 * invalidate existing hashes - each one keeps verifying under the settings it
 * was created with, and `needsRehash` reports which ones are due an upgrade.
 */

export interface PasswordHashOptions {
  /** Argon2 memory cost in KiB. */
  memoryCost?: number;
  /** Number of passes. */
  timeCost?: number;
  /** Lanes used. */
  parallelism?: number;
}

/**
 * A hash of a value nobody will ever verify against, used to spend the same
 * time on a login for an unknown address as on a real one.
 *
 * Generated once per process from random bytes: it is never stored, never
 * matched, and its only purpose is to make the "no such user" path take as long
 * as the "wrong password" path. Without it, response timing alone enumerates
 * every registered email address.
 */
const DUMMY_HASH_PROMISE = (async (): Promise<string> => {
  const hash = await argon2.hash(`easytube-timing-equaliser-${crypto.randomUUID()}`, {
    type: argon2.argon2id,
    memoryCost: env.ARGON2_MEMORY_COST_KIB,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });
  return hash;
})();

function options(overrides: PasswordHashOptions = {}): argon2.Options & { raw?: false } {
  return {
    type: argon2.argon2id,
    memoryCost: overrides.memoryCost ?? env.ARGON2_MEMORY_COST_KIB,
    timeCost: overrides.timeCost ?? env.ARGON2_TIME_COST,
    parallelism: overrides.parallelism ?? env.ARGON2_PARALLELISM,
  };
}

/**
 * Combines the password with the server-side pepper.
 *
 * Hashing `password + pepper` means a database dump on its own is not enough to
 * mount an offline attack. The pepper never leaves the environment, so the dump
 * and the pepper must be compromised separately.
 */
function withPepper(password: string): string {
  return env.AUTH_PEPPER ? `${password}${env.AUTH_PEPPER}` : password;
}

export async function hashPassword(
  password: string,
  overrides: PasswordHashOptions = {},
): Promise<string> {
  return argon2.hash(withPepper(password), options(overrides));
}

export interface VerifyResult {
  valid: boolean;
  /** True when the stored hash used weaker parameters than we now require. */
  needsRehash: boolean;
}

export async function verifyPassword(hash: string, password: string): Promise<VerifyResult> {
  let valid: boolean;

  try {
    valid = await argon2.verify(hash, withPepper(password), options());
  } catch {
    // A malformed or foreign-format hash is a failed verification, not a 500.
    return { valid: false, needsRehash: false };
  }

  return { valid, needsRehash: valid && needsRehash(hash) };
}

/**
 * Whether a stored hash was made with weaker parameters than the current
 * configuration, so a successful login can transparently upgrade it.
 */
export function needsRehash(hash: string, overrides: PasswordHashOptions = {}): boolean {
  const wanted = options(overrides);

  try {
    return argon2.needsRehash(hash, {
      timeCost: wanted.timeCost,
      memoryCost: wanted.memoryCost,
      parallelism: wanted.parallelism,
    });
  } catch {
    return false;
  }
}

/**
 * Burns roughly the same time as a real verification. Called on the
 * "no account with that email" path so a caller cannot tell the two apart by
 * response time.
 */
export async function equaliseTiming(): Promise<void> {
  const dummy = await DUMMY_HASH_PROMISE;
  try {
    await argon2.verify(dummy, `wrong-${crypto.randomUUID()}`);
  } catch {
    // Expected: the dummy password does not match. The work is the point.
  }
}
