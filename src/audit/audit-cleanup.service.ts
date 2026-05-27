import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from './audit.service';

/**
 * Cron-based reaper for audits stuck in pending/processing past
 * `AUDIT_TIMEOUT_MS`. Runs every minute — cheap UPDATE, no contention.
 *
 * Pairs with the pipeline's own try/catch: most failures self-mark as
 * `failure`, but a serverless cold-killed function leaves the row
 * mid-flight. This sweep ensures those flip to `failed`/`timeout` so the
 * frontend stops polling.
 */
@Injectable()
export class AuditCleanupService {
  private readonly log = new Logger(AuditCleanupService.name);

  constructor(
    private readonly audits: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reapStale(): Promise<void> {
    const timeoutMs = this.config.get<number>('AUDIT_TIMEOUT_MS', 120_000);
    const count = await this.audits.markStaleAsTimedOut(timeoutMs);
    if (count > 0) this.log.warn(`Reaped ${count} stale audit(s) past ${timeoutMs}ms timeout`);
  }
}
