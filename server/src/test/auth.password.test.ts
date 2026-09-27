import { describe, expect, it } from 'vitest';

import { equaliseTiming, hashPassword, needsRehash, verifyPassword } from '../utils/password';

/**
 * The only suite that runs real argon2. Kept small on purpose: production
 * parameters take tens of milliseconds per operation, so a handful of round
 * trips is enough to prove the contract and cheap enough to run on every commit.
 *
 * The policy is intentionally exercised at deliberately weak parameters, so the
 * tests do not spend a second of CPU proving that argon2 is slow.
 */
const WEAK = { memoryCost: 8_192, timeCost: 2, parallelism: 1 };

describe('password hashing', () => {
  it('produces an argon2id hash that verifies against the original password', async () => {
    // Production parameters, so `needsRehash` is genuinely false rather than
    // accidentally true because the test used cheaper settings.
    const hash = await hashPassword('CorrectHorseBattery9');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    // The plaintext must never appear in the stored value.
    expect(hash).not.toContain('CorrectHorseBattery9');

    const result = await verifyPassword(hash, 'CorrectHorseBattery9');
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(false);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('CorrectHorseBattery9', WEAK);

    const result = await verifyPassword(hash, 'CorrectHorseBattery10');
    expect(result.valid).toBe(false);
  });

  it('salts each hash, so identical passwords do not collide', async () => {
    const first = await hashPassword('CorrectHorseBattery9', WEAK);
    const second = await hashPassword('CorrectHorseBattery9', WEAK);

    expect(first).not.toBe(second);
  });

  it('reports a failed verification for a malformed hash instead of throwing', async () => {
    // A corrupt or foreign-format value in the database must surface as a failed
    // login, not a 500 that tells an attacker the row is malformed.
    const result = await verifyPassword('not-a-hash', 'CorrectHorseBattery9');
    expect(result).toEqual({ valid: false, needsRehash: false });
  });

  it('flags a hash made at weaker parameters, while still accepting it', async () => {
    const weak = await hashPassword('CorrectHorseBattery9', WEAK);

    // Production defaults are far stronger than WEAK, so this hash is due an
    // upgrade. That is the signal a successful login uses to upgrade in place
    // rather than forcing every user through a reset.
    expect(needsRehash(weak)).toBe(true);
    expect(needsRehash(weak, WEAK)).toBe(false);

    // Crucially the hash still verifies while flagged, so the upgrade can happen
    // on the way through an ordinary login.
    const result = await verifyPassword(weak, 'CorrectHorseBattery9');
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  it('treats an unparseable hash as not needing a rehash', () => {
    expect(needsRehash('rubbish')).toBe(false);
  });
});

describe('equaliseTiming', () => {
  it('completes without throwing for repeated calls', async () => {
    await expect(equaliseTiming()).resolves.toBeUndefined();
    await expect(equaliseTiming()).resolves.toBeUndefined();
  });
});
