import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { UnauthorizedSessionException } from '@/common/exceptions/custom.exceptions';
import { AuthService } from './auth.service';

/**
 * Guards routes that require an authenticated principal. Reads the bearer
 * token, resolves it to a session, and attaches the user to `request.user`.
 * Throws 401 UNAUTHORIZED on any miss.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedSessionException('Missing bearer token');

    const user = await this.auth.validateSession(token);
    if (!user) throw new UnauthorizedSessionException('Invalid or expired session');

    request.user = user;
    return true;
  }
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}
