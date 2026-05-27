import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';

interface ErrorBody {
  error: string;
  message: string;
}

/**
 * Formats every thrown error into the API contract:
 *   { error: MACHINE_CODE, message: human-readable }
 *
 * Also translates Prisma errors:
 *   - P2002 unique violation → 409 DUPLICATE
 *   - P2025 not found        → 404 NOT_FOUND
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    const status = this.toStatus(exception);
    const body = this.toErrorBody(exception, status);

    if (status >= 500) {
      this.log.error({ err: exception }, `${body.error}: ${body.message}`);
    }

    response.status(status).json(body);
  }

  private toStatus(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus();
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') return HttpStatus.CONFLICT;
      if (exception.code === 'P2025') return HttpStatus.NOT_FOUND;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private toErrorBody(exception: unknown, status: number): ErrorBody {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, unknown>;
        // ValidationPipe emits `message: string[]` on multi-field errors — flatten.
        const rawMessage = obj.message;
        const message = Array.isArray(rawMessage)
          ? rawMessage.join('; ')
          : ((rawMessage as string | undefined) ?? exception.message);
        return {
          error: (obj.error as string) ?? HttpStatus[status],
          message,
        };
      }
      return {
        error: HttpStatus[status],
        message: typeof res === 'string' ? res : exception.message,
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return { error: 'DUPLICATE', message: 'Resource already exists' };
      }
      if (exception.code === 'P2025') {
        return { error: 'NOT_FOUND', message: 'Resource not found' };
      }
    }
    return { error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
  }
}
