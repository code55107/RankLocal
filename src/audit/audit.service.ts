import { Injectable, Logger } from '@nestjs/common';
import { Audit, AuditStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  AiRecommendation,
  AuditErrorType,
  AuditFormInput,
  AuditResult,
  AuditStatusResponse,
  AuditStatusStep,
  CategoryScore,
  CompetitorData,
  MatchedBusiness,
  ScoreRating,
} from '@/types/audit';
import {
  RateLimitException,
  ResourceNotFoundException,
} from '@/common/exceptions/custom.exceptions';
import { RateLimitService } from './rate-limit.service';
import { AuditPipelineService } from './pipeline/audit-pipeline.service';

@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly pipeline: AuditPipelineService,
  ) {}

  /**
   * Creates a new audit row in `pending` and kicks off the pipeline in the
   * background. Returns the audit id immediately so the client can begin
   * polling — the spec's Next.js `after()` flow maps to "don't await the
   * pipeline promise" here.
   */
  async submit(input: AuditFormInput, ipAddress: string): Promise<{ auditId: string }> {
    if (!(await this.rateLimit.withinLimit(ipAddress))) {
      throw new RateLimitException("You've hit your audit limit for the hour.");
    }

    const created = await this.prisma.audit.create({
      data: {
        status: AuditStatus.pending,
        ipAddress,
        email: input.email,
        input: input as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // Fire-and-forget. Awaiting would defeat the async pipeline contract; any
    // throw is captured inside the pipeline and persisted as `failed`/`failure`.
    void this.pipeline.run(created.id).catch((err) => {
      this.log.error({ err, auditId: created.id }, 'Pipeline kickoff failed');
    });

    return { auditId: created.id };
  }

  async getStatus(id: string): Promise<AuditStatusResponse> {
    const audit = await this.prisma.audit.findUnique({ where: { id } });
    if (!audit) throw new ResourceNotFoundException('Audit');

    // Multiple-match state takes precedence — the user must pick before the
    // pipeline can continue.
    if (audit.matchedBusinesses && Array.isArray(audit.matchedBusinesses)) {
      const matches = audit.matchedBusinesses as unknown as MatchedBusiness[];
      if (matches.length > 1) {
        return { status: 'multiple_matches', matches };
      }
    }

    if (audit.status === AuditStatus.failed) {
      return { status: 'failed', errorType: (audit.errorType as AuditErrorType) ?? 'failure' };
    }
    if (audit.status === AuditStatus.completed) {
      return { status: 'completed', result: this.toAuditResult(audit) };
    }
    if (audit.status === AuditStatus.processing) {
      return {
        status: 'processing',
        currentStep: (audit.currentStep as AuditStatusStep) ?? 'find',
      };
    }
    return { status: 'pending' };
  }

  /** Internal helper for the cleanup cron — reap audits stuck past timeout. */
  async markStaleAsTimedOut(timeoutMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - timeoutMs);
    const updated = await this.prisma.audit.updateMany({
      where: {
        status: { in: [AuditStatus.processing, AuditStatus.pending] },
        updatedAt: { lt: cutoff },
      },
      data: { status: AuditStatus.failed, errorType: 'timeout', currentStep: null },
    });
    return updated.count;
  }

  private toAuditResult(audit: Audit): AuditResult {
    const categoryScores = (audit.categoryScores as unknown as CategoryScore[]) ?? [];
    const recommendations = (audit.recommendations as unknown as AiRecommendation[]) ?? [];
    const competitors = (audit.competitors as unknown as CompetitorData[]) ?? [];

    return {
      id: audit.id,
      businessName: audit.businessName ?? '',
      address: audit.address ?? '',
      primaryCategory: audit.primaryCategory ?? '',
      isVerified: audit.isVerified,
      isPermanentlyClosed: audit.isPermanentlyClosed,
      hasWebsite: audit.hasWebsite,
      websiteUrl: audit.websiteUrl ?? undefined,
      websiteLoadTime: audit.websiteLoadTime ?? undefined,
      mobileFriendly: audit.mobileFriendly ?? undefined,
      overallScore: audit.overallScore ?? 0,
      overallRating: (audit.overallRating as ScoreRating) ?? 'critical',
      categoryScores,
      recommendations,
      competitors,
      hasEverPosted: audit.hasEverPosted,
      postsSupported: audit.postsSupported,
      createdAt: audit.createdAt.toISOString(),
      completedAt: audit.completedAt?.toISOString(),
    };
  }
}
