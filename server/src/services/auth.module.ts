import { createAuditRepository } from '../repositories/audit.repository';
import { createRefreshSessionRepository } from '../repositories/refresh-session.repository';
import { createUserRepository } from '../repositories/user.repository';
import { createAuthService, type AuthService, type UserPort } from './auth.service';

/**
 * The composition root for authentication.
 *
 * Lives in one place so the only difference between the running app and a test
 * is which repositories are supplied. Everything below is a plain factory, so
 * there is no module-level singleton to reset between tests.
 */
export interface AuthModule {
  service: AuthService;
  /**
   * The user port on its own, for `authenticate`, which only ever needs to read
   * a user. Sharing one instance means both see the same in-process caches, if
   * any are added later.
   */
  users: UserPort;
}

export function createAuthModule(): AuthModule {
  const users = createUserRepository();

  return {
    users,
    service: createAuthService({
      users,
      sessions: createRefreshSessionRepository(),
      audit: createAuditRepository(),
    }),
  };
}
