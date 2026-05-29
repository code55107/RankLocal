import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Rate-limit (429). Distinct error code so the frontend can render the
 * dedicated `rate-limit` audit error state (spec §11).
 */
export class RateLimitException extends HttpException {
  constructor(message = 'Too many audits. Try again in an hour.') {
    super({ error: 'RATE_LIMIT', message }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export class ResourceNotFoundException extends NotFoundException {
  constructor(resource: string) {
    super({ error: 'NOT_FOUND', message: `${resource} not found` });
  }
}

export class ValidationFailedException extends BadRequestException {
  constructor(message: string) {
    super({ error: 'VALIDATION_ERROR', message });
  }
}

// ---- Auth (backend-auth-spec.md) ----

/** Registration with an email that already exists. */
export class EmailExistsException extends ConflictException {
  constructor() {
    super({ error: 'EMAIL_EXISTS', message: 'An account with this email already exists' });
  }
}

/** Login with a wrong email or password (kept deliberately vague to avoid
 *  leaking which of the two was wrong). */
export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
  }
}

/** Token missing, malformed, invalid, or expired. */
export class UnauthorizedSessionException extends UnauthorizedException {
  constructor(message = 'Authentication required') {
    super({ error: 'UNAUTHORIZED', message });
  }
}

/** Google OAuth authorization code is invalid or expired (Google returns
 *  `invalid_grant` / HTTP 400 at the token endpoint). */
export class InvalidCodeException extends BadRequestException {
  constructor() {
    super({ error: 'INVALID_CODE', message: 'Authorization code is invalid or expired' });
  }
}

/** Any non-recoverable failure talking to Google (network, 5xx, or missing
 *  server-side OAuth credentials). */
export class GoogleErrorException extends InternalServerErrorException {
  constructor(message = 'Failed to authenticate with Google') {
    super({ error: 'GOOGLE_ERROR', message });
  }
}
