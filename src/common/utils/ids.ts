import { randomUUID } from 'crypto';

/** `usr_<uuid-no-dashes>` — stable, opaque, prefix-tagged user id. */
export function newUserId(): string {
  return `usr_${randomUUID().replace(/-/g, '')}`;
}

/** `sess_<uuid>` — opaque session token (spec: 30-day server-side session). */
export function newSessionToken(): string {
  return `sess_${randomUUID()}`;
}
