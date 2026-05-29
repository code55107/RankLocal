/**
 * Auth contracts (backend-auth-spec.md). These ship verbatim to the frontend
 * BFF — the auth endpoints return these shapes directly, NOT wrapped in the
 * `{ success, data }` envelope the audit endpoints use.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  provider: 'email' | 'google';
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}
