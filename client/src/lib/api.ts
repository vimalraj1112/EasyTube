import { http } from './apiClient';
import type {
  ApiSuccess,
  AuthSession,
  AuthSessionPayload,
  AuthUser,
  ChangePasswordInput,
  HealthData,
  LoginInput,
  RegisterInput,
} from '@/types/api';

/**
 * Unwraps the server envelope. Throws `ApiClientError` on any failure so
 * callers only ever deal with one error shape.
 */
async function unwrap<T>(request: Promise<{ data: ApiSuccess<T> }>): Promise<T> {
  const response = await request;
  return response.data.data;
}

/**
 * Auth calls.
 *
 * None of these touch `sessionStore`: storing the returned tokens is the
 * caller's decision, so `AuthProvider` stays the single place that decides what
 * "signed in" means. The one exception is the silent refresh inside
 * `apiClient`, which has to store tokens itself because it runs below the UI.
 */
export const authApi = {
  register: (input: RegisterInput): Promise<AuthSessionPayload> =>
    unwrap<AuthSessionPayload>(http.post<ApiSuccess<AuthSessionPayload>>('/auth/register', input)),

  login: (input: LoginInput): Promise<AuthSessionPayload> =>
    unwrap<AuthSessionPayload>(http.post<ApiSuccess<AuthSessionPayload>>('/auth/login', input)),

  /** Redeems the refresh cookie. Rejects when there is no usable session. */
  refresh: (): Promise<AuthSessionPayload> =>
    unwrap<AuthSessionPayload>(http.post<ApiSuccess<AuthSessionPayload>>('/auth/refresh')),

  logout: (): Promise<{ sessionId: string | null }> =>
    unwrap<{ sessionId: string | null }>(
      http.post<ApiSuccess<{ sessionId: string | null }>>('/auth/logout'),
    ),

  logoutAll: (): Promise<{ revoked: number }> =>
    unwrap<{ revoked: number }>(http.post<ApiSuccess<{ revoked: number }>>('/auth/logout-all')),

  me: (): Promise<{ user: AuthUser }> =>
    unwrap<{ user: AuthUser }>(http.get<ApiSuccess<{ user: AuthUser }>>('/auth/me')),

  changePassword: (input: ChangePasswordInput): Promise<AuthSessionPayload> =>
    unwrap<AuthSessionPayload>(
      http.post<ApiSuccess<AuthSessionPayload>>('/auth/change-password', input),
    ),

  sessions: (): Promise<{ sessions: AuthSession[] }> =>
    unwrap<{ sessions: AuthSession[] }>(
      http.get<ApiSuccess<{ sessions: AuthSession[] }>>('/auth/sessions'),
    ),

  revokeSession: (sessionId: string): Promise<{ sessionId: string }> =>
    unwrap<{ sessionId: string }>(
      http.delete<ApiSuccess<{ sessionId: string }>>(`/auth/sessions/${sessionId}`),
    ),
};

export const api = {
  health: (): Promise<HealthData> =>
    unwrap<HealthData>(http.get<ApiSuccess<HealthData>>('/health')),
  auth: authApi,
};
