/**
 * Shared API envelope types. Every JSON response produced by the server uses
 * one of these two shapes so the client can narrow on `success`.
 */

export interface ApiMeta {
  /** Correlation id, also emitted as the `x-request-id` response header. */
  requestId: string;
}

export interface ApiSuccess<TData = undefined> extends ApiMeta {
  success: true;
  message: string;
  data: TData;
}

export interface ApiErrorDetail {
  code: string;
  /** Field-level issues, present for validation failures. */
  details?: unknown;
}

export interface ApiFailure extends ApiMeta {
  success: false;
  message: string;
  error: ApiErrorDetail;
}

export type ApiResponse<TData = undefined> = ApiSuccess<TData> | ApiFailure;

export interface Paginated<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** Liveness payload - proves the process is alive, nothing more. */
export interface HealthData {
  status: 'ok';
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
}

export type ProbeStatus = 'up' | 'down';

export interface DependencyCheck {
  status: ProbeStatus;
  latencyMs: number | null;
  detail: string;
}

export interface ReadinessReport {
  ready: boolean;
  checks: Record<string, DependencyCheck>;
}
