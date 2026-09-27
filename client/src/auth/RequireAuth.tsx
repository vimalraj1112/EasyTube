import type { PropsWithChildren } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from './authContext';
import { Spinner } from '@/components/ui/Spinner';

/** Gate for signed-in-only routes. */
export function RequireAuth({ children }: PropsWithChildren) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="grid min-h-[60vh] place-items-center text-ink-400">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  if (status === 'anonymous') {
    // `state.from` lets the sign-in page send the user back where they were
    // headed instead of always dumping them on the account page.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

/** Keeps a signed-in user away from the sign-in and registration screens. */
export function RedirectIfAuthenticated({ children }: PropsWithChildren) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="grid min-h-[60vh] place-items-center text-ink-400">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  if (status === 'authenticated') {
    return <Navigate to="/account" replace />;
  }

  return <>{children}</>;
}
