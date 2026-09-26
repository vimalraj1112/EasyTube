/** Mirrors the server envelope so responses are typed end to end. */
export interface ApiMeta {
  requestId: string;
}

export interface ApiSuccess<TData = undefined> extends ApiMeta {
  success: true;
  message: string;
  data: TData;
}

export interface ApiErrorDetail {
  code: string;
  details?: unknown;
}

export interface ApiFailure extends ApiMeta {
  success: false;
  message: string;
  error: ApiErrorDetail;
}

export type ApiResponse<TData = undefined> = ApiSuccess<TData> | ApiFailure;

export interface HealthData {
  status: 'ok';
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
}
