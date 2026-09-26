import { useCallback, useEffect, useRef, useState } from 'react';

import { clientEnv } from '@/config/env';
import { api } from '@/lib/api';
import { ApiClientError } from '@/lib/apiClient';
import type { HealthData } from '@/types/api';

export type ApiStatus = 'checking' | 'online' | 'offline';

export interface ApiHealthState {
  status: ApiStatus;
  data: HealthData | null;
  error: ApiClientError | null;
  lastCheckedAt: Date | null;
  /** Triggers an immediate re-check. */
  refetch: () => void;
}

/**
 * Polls `GET /api/v1/health` to drive the connection indicator.
 *
 * The interval is paused while the tab is hidden to avoid pointless requests,
 * and every in-flight request is discarded on unmount.
 */
export function useApiHealth(pollIntervalMs = clientEnv.VITE_HEALTH_POLL_INTERVAL_MS): ApiHealthState {
  const [status, setStatus] = useState<ApiStatus>('checking');
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const check = useCallback(async (): Promise<void> => {
    setStatus('checking');
    try {
      const health = await api.health();
      if (!isMounted.current) return;
      setData(health);
      setError(null);
      setStatus('online');
    } catch (cause) {
      if (!isMounted.current) return;
      setData(null);
      setError(ApiClientError.from(cause));
      setStatus('offline');
    } finally {
      if (isMounted.current) setLastCheckedAt(new Date());
    }
  }, []);

  useEffect(() => {
    void check();

    const tick = (): void => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void check();
    };

    const intervalId = window.setInterval(tick, pollIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [check, pollIntervalMs]);

  return { status, data, error, lastCheckedAt, refetch: () => void check() };
}
