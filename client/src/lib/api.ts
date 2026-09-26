import { http } from './apiClient';
import type { ApiSuccess, HealthData } from '@/types/api';

/**
 * Unwraps the server envelope. Throws `ApiClientError` on any failure so
 * callers only ever deal with one error shape.
 */
async function unwrap<T>(request: Promise<{ data: ApiSuccess<T> }>): Promise<T> {
  const response = await request;
  return response.data.data;
}

export const api = {
  health: (): Promise<HealthData> => unwrap<HealthData>(http.get<ApiSuccess<HealthData>>('/health')),
};
