/**
 * Canonical success envelope used by /api/v1 endpoints.
 *   { success: true, data: T }
 * Errors are emitted by GlobalExceptionFilter as { error, message } (no
 * `success: false` wrapper — the HTTP status carries that signal).
 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export const ok = <T>(data: T): ApiSuccess<T> => ({ success: true, data });
