import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Rolling 1-hour rate limit, query-based. Each IP gets `RATE_LIMIT_MAX_PER_HOUR`
 * audit creations (default 10). We count directly against the `audits` table
 * so v1 doesn't need Redis.
 *
 * Race-safe enough: an attacker squeezing extra calls inside the same second
 * gains at most a handful of audits — well below abuse-relevant thresholds.
 */
@Injectable()
export class RateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async withinLimit(ipAddress: string): Promise<boolean> {
    const max = this.config.get<number>('RATE_LIMIT_MAX_PER_HOUR', 10);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const count = await this.prisma.audit.count({
      where: { ipAddress, createdAt: { gte: oneHourAgo } },
    });
    return count < max;
  }
}
