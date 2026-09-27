import { useReducedMotion } from 'framer-motion';
import { ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';

import { useAuth } from '@/auth/authContext';
import { Logo } from '@/components/brand/Logo';
import { cn } from '@/lib/utils';

/** Home and the account screen exist; the rest arrive in later phases. */
const NAV_LINKS = [
  { to: '/', label: 'Home', isReady: true },
  { to: '/downloads', label: 'Downloads', isReady: false },
  { to: '/history', label: 'History', isReady: false },
  { to: '/about', label: 'About', isReady: false },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-100/10 bg-ink-1000/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="EasyTube home" className="rounded-lg">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) =>
            link.isReady ? (
              <NavLink
                key={link.to}
                to={link.to}
                end
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm transition-colors duration-200',
                    isActive ? 'text-ink-50' : 'text-ink-300 hover:text-ink-50',
                  )
                }
              >
                {link.label}
              </NavLink>
            ) : (
              <span
                key={link.to}
                aria-disabled="true"
                title="Coming in a later phase"
                className="cursor-not-allowed rounded-lg px-3 py-2 text-sm text-ink-500"
              >
                {link.label}
              </span>
            ),
          )}
        </nav>

        <div className="flex items-center gap-2">
          <AccountControls />
        </div>
      </div>
    </header>
  );
}

/**
 * Sign-in links, or the signed-in user's name plus a sign-out button.
 *
 * Reads auth state rather than taking props so the header and the routes can
 * never disagree about who is signed in.
 */
function AccountControls() {
  const { status, user, logout } = useAuth();

  if (status === 'loading') {
    return <span className="hidden px-3 py-2 text-sm text-ink-500 sm:inline">Checking…</span>;
  }

  if (status === 'anonymous' || !user) {
    return (
      <>
        <Link
          to="/login"
          className="rounded-lg px-3 py-2 text-sm text-ink-300 transition-colors duration-200 hover:text-ink-50"
        >
          Sign in
        </Link>
        <Link
          to="/register"
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-brand-500"
        >
          Create account
        </Link>
      </>
    );
  }

  return (
    <>
      <NavLink
        to="/account"
        className={({ isActive }) =>
          cn(
            'max-w-[10rem] truncate rounded-lg px-3 py-2 text-sm transition-colors duration-200',
            isActive ? 'text-ink-50' : 'text-ink-300 hover:text-ink-50',
          )
        }
      >
        {user.displayName}
      </NavLink>
      <button
        type="button"
        onClick={() => void logout()}
        className="rounded-lg border border-ink-100/15 px-3 py-2 text-sm text-ink-300 transition-colors duration-200 hover:border-rose-400/40 hover:text-rose-200"
      >
        Sign out
      </button>
    </>
  );
}

/** Decorative, purely presentational background for the hero. */
export function AuroraBackground() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-grid opacity-60" />
      <div
        className={cn(
          'absolute -top-40 left-1/2 size-[42rem] -translate-x-1/2 rounded-full',
          'bg-[radial-gradient(closest-side,rgb(117_71_247/0.28),transparent)] blur-2xl',
          !prefersReducedMotion && 'animate-aurora',
        )}
      />
      <div className="absolute right-[-10rem] top-24 size-[28rem] rounded-full bg-[radial-gradient(closest-side,rgb(6_182_212/0.16),transparent)] blur-2xl" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-1000 to-transparent" />
    </div>
  );
}

export const VALUE_PROPS = [
  { icon: Sparkles, title: 'Supported media', copy: 'Clear, honest format listings.' },
  { icon: Zap, title: 'Fast processing', copy: 'Queued jobs with live progress.' },
  { icon: ShieldCheck, title: 'Secure handling', copy: 'Signed links, no stored secrets.' },
] as const;
