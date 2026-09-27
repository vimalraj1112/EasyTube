import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { changePasswordSchema, type ChangePasswordValues } from '@/auth/authSchemas';
import { useAuth } from '@/auth/authContext';
import { FormAlert, TextField } from '@/components/ui/FormField';
import { Spinner } from '@/components/ui/Spinner';
import { StatusPill } from '@/components/ui/StatusPill';
import { authApi } from '@/lib/api';
import { ApiClientError } from '@/lib/apiClient';
import { sessionStore } from '@/lib/sessionStore';
import { formatDateTime } from '@/lib/utils';
import type { AuthSession } from '@/types/api';

export function AccountPage() {
  const { user, logout, logoutAll } = useAuth();
  const [sessions, setSessions] = useState<AuthSession[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);

  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      const { sessions: loaded } = await authApi.sessions();
      setSessions(loaded);
      setSessionsError(null);
    } catch (error) {
      setSessionsError(ApiClientError.from(error).message);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onChangePassword = handleSubmit(async (values) => {
    setPasswordNotice(null);
    setPasswordError(null);
    try {
      // The endpoint ends every session, including this one, and returns a fresh
      // token pair - so the response has to become the live session or the next
      // request would go out with the tokens that were just revoked.
      sessionStore.set(await authApi.changePassword(values));
      setPasswordNotice('Password changed. Other devices have been signed out.');
      reset();
      await loadSessions();
    } catch (error) {
      setPasswordError(ApiClientError.from(error).message);
    }
  });

  async function revoke(session: AuthSession): Promise<void> {
    setBusySessionId(session.id);
    try {
      await authApi.revokeSession(session.id);
      if (session.current) {
        // Revoking the session this tab is using clears the cookie server-side.
        await logout();
        return;
      }
      await loadSessions();
    } catch (error) {
      setSessionsError(ApiClientError.from(error).message);
    } finally {
      setBusySessionId(null);
    }
  }

  if (!user) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-12 sm:px-6">
      {/* A div, not a <header>: the site header already owns the banner landmark. */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Your account</h1>
        <p className="mt-2 text-sm text-ink-400">Signed in as {user.email}</p>
      </div>

      <section className="rounded-2xl border border-ink-100/10 bg-ink-1000/40 p-6">
        <h2 className="text-lg font-medium">Profile</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wider text-ink-500">Name</dt>
            <dd className="mt-1 text-sm">{user.displayName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-ink-500">Email</dt>
            <dd className="mt-1 text-sm">{user.email}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-ink-500">Role</dt>
            <dd className="mt-1 text-sm">{user.role}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-ink-500">Member since</dt>
            <dd className="mt-1 text-sm">{formatDateTime(user.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-ink-100/10 bg-ink-1000/40 p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">Active sessions</h2>
          <button
            type="button"
            onClick={() => void logoutAll()}
            className="rounded-lg border border-ink-100/15 px-3 py-1.5 text-xs text-ink-300 transition-colors duration-200 hover:border-rose-400/40 hover:text-rose-200"
          >
            Sign out everywhere
          </button>
        </div>

        {sessionsError ? (
          <div className="mt-4">
            <FormAlert tone="danger">{sessionsError}</FormAlert>
          </div>
        ) : null}

        {sessions === null && !sessionsError ? (
          <div className="mt-6 text-ink-400">
            <Spinner label="Loading your sessions" />
          </div>
        ) : null}

        {sessions?.length === 0 ? (
          <p className="mt-4 text-sm text-ink-400">No other sessions are active.</p>
        ) : null}

        <ul className="mt-4 flex flex-col gap-3">
          {sessions?.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100/10 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm">
                  <span className="truncate">{session.userAgent ?? 'Unknown device'}</span>
                  {session.current ? <StatusPill tone="success" label="This device" /> : null}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  {session.ip ?? 'Unknown IP'} · started {formatDateTime(session.createdAt)} ·
                  expires {formatDateTime(session.expiresAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void revoke(session)}
                disabled={busySessionId === session.id}
                className="rounded-lg border border-ink-100/15 px-3 py-1.5 text-xs text-ink-300 transition-colors duration-200 hover:border-rose-400/40 hover:text-rose-200 disabled:opacity-60"
              >
                {busySessionId === session.id ? 'Revoking…' : 'Revoke'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-ink-100/10 bg-ink-1000/40 p-6">
        <h2 className="text-lg font-medium">Change password</h2>
        <p className="mt-1 text-sm text-ink-400">
          Changing it signs every other device out. This one stays signed in.
        </p>

        <form
          onSubmit={(event) => void onChangePassword(event)}
          className="mt-5 flex max-w-md flex-col gap-5"
          noValidate
        >
          {passwordNotice ? <FormAlert tone="success">{passwordNotice}</FormAlert> : null}
          {passwordError ? <FormAlert tone="danger">{passwordError}</FormAlert> : null}

          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />

          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters, with lower case, upper case and a digit."
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? <Spinner label="Updating your password" /> : null}
              {isSubmitting ? 'Updating…' : 'Change password'}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-xl border border-ink-100/15 px-5 py-2.5 text-sm text-ink-300 transition-colors duration-200 hover:border-rose-400/40 hover:text-rose-200"
            >
              Sign out
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
