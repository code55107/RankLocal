import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

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
