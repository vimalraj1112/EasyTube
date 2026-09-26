import { motion, useReducedMotion } from 'framer-motion';
import { Activity, RefreshCw, WifiOff } from 'lucide-react';

import { StatusPill } from '@/components/ui/StatusPill';
import { Spinner } from '@/components/ui/Spinner';
import { useApiHealth } from '@/hooks/useApiHealth';
import { cn } from '@/lib/utils';

const COPY = {
  checking: { tone: 'pending', label: 'Checking API' },
  online: { tone: 'success', label: 'API Connected' },
  offline: { tone: 'danger', label: 'API Unreachable' },
} as const;

/**
 * Live connection indicator for the EasyTube API. This is the Phase 1
 * acceptance surface: the brand renders and the status reflects the real
 * `GET /api/v1/health` response.
 */
export function ApiStatusCard({ className }: { className?: string }) {
  const prefersReducedMotion = useReducedMotion();
  const { status, data, lastCheckedAt, refetch } = useApiHealth();

  const copy = COPY[status];
  const isOffline = status === 'offline';

  return (
    <motion.section
      aria-label="API connection status"
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15, ease: 'easeOut' }}
      className={cn(
        'glass-panel w-full max-w-md rounded-card border border-ink-100/10 p-5',
        'shadow-[0_24px_70px_-40px_rgb(0_0_0/0.9)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-ink-400">
            Service status
          </p>
          <div className="mt-2.5">
            <StatusPill tone={copy.tone} label={copy.label} pulse={status === 'checking'} />
          </div>
        </div>

        <button
          type="button"
          onClick={refetch}
          disabled={status === 'checking'}
          aria-label="Recheck API status"
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-lg border border-ink-100/10',
            'text-ink-300 transition-colors duration-200',
            'hover:border-ink-100/20 hover:text-ink-50',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {status === 'checking' ? (
            <Spinner className="text-ink-300" label="Rechecking" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {status === 'online' && data && (
        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-ink-100/10 pt-4 text-xs">
          <div className="min-w-0">
            <dt className="text-ink-400">Version</dt>
            <dd className="mt-1 truncate font-medium text-ink-100">v{data.version}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-400">Environment</dt>
            <dd className="mt-1 truncate font-medium capitalize text-ink-100">
              {data.environment}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-400">Uptime</dt>
            <dd className="mt-1 font-medium text-ink-100">
              {Math.floor(data.uptimeSeconds / 60)}m {data.uptimeSeconds % 60}s
            </dd>
          </div>
        </dl>
      )}

      {isOffline && (
        <p className="mt-5 flex items-start gap-2 border-t border-ink-100/10 pt-4 text-xs leading-relaxed text-ink-300">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-rose-300" aria-hidden="true" />
          <span>
            Couldn&rsquo;t reach the EasyTube API. Start the server with{' '}
            <code className="rounded bg-ink-100/10 px-1 py-0.5 font-mono text-[0.7rem]">
              npm run dev:server
            </code>
            .
          </span>
        </p>
      )}

      {lastCheckedAt && (
        <p className="mt-4 flex items-center gap-1.5 text-[0.7rem] text-ink-500">
          <Activity className="size-3" aria-hidden="true" />
          Last checked {lastCheckedAt.toLocaleTimeString()}
        </p>
      )}
    </motion.section>
  );
}
