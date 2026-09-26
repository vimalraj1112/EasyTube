import { useReducedMotion } from 'framer-motion';
import { ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';

import { Logo } from '@/components/brand/Logo';
import { cn } from '@/lib/utils';

/** Phase 1 ships the home route only; the rest arrive in later phases. */
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
          <span
            className="hidden rounded-lg border border-ink-100/10 px-3 py-2 text-sm text-ink-400 sm:inline"
            title="Account system arrives in Phase 11"
          >
            Login
          </span>
        </div>
      </div>
    </header>
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
