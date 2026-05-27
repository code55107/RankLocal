import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditStatus, Prisma } from '@prisma/client';
import { AuditErrorType, AuditStatusStep } from '@/types/audit';
import { MatchedBusiness } from '@/types/audit';
import { EmailService } from '@/email/email.service';
import { FindService } from './steps/find.service';
import { ProfileService } from './steps/profile.service';
import { CompetitorsService } from './steps/competitors.service';
import { ScoringService } from './steps/scoring.service';
import { PlanService } from './steps/plan.service';
import { BusinessProfile } from './types';

/**
 * Orchestrates the 5-step audit pipeline. Each step writes `currentStep` to
 * Postgres before running so the polling endpoint reflects real progress.
 *
 * On any unhandled throw the audit is marked `failed`/`failure`. Specific
 * fail modes (not-found, multiple matches) are signalled by step returns and
 * mapped to richer state by this orchestrator.
 */
@Injectable()
export class AuditPipelineService {
  private readonly log = new Logger(AuditPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly find: FindService,
    private readonly profile: ProfileService,
    private readonly competitors: CompetitorsService,
    private readonly scoring: ScoringService,
    private readonly plan: PlanService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async run(auditId: string): Promise<void> {
    try {
      const audit = await this.prisma.audit.findUnique({ where: { id: auditId } });
      if (!audit) {
        this.log.error(`Pipeline kicked for missing audit ${auditId}`);
        return;
      }

      const input = audit.input as {
        businessName: string;
        websiteUrl: string;
        location: string;
        email: string;
      };

      // ---- Step 1: find ----
      await this.setStep(auditId, 'find');
      const found = await this.find.run({
        businessName: input.businessName,
        location: input.location,
      });
      if (found.type === 'not_found') return this.markFailed(auditId, 'not-found');
      if (found.type === 'multiple') return this.markMultipleMatches(auditId, found.matches);

      // ---- Step 2: profile ----
      await this.setStep(auditId, 'profile');
      const { profile, raw: profileRaw } = await this.profile.run(found.placeId);

      // ---- Step 3: competitors ----
      await this.setStep(auditId, 'competitors');
      const { competitors, raw: competitorRaw } = await this.competitors.run(profile);

      // ---- Step 4: scoring ----
      await this.setStep(auditId, 'scoring');
      const scoring = this.scoring.run(profile);

      // ---- Step 5: plan ----
      await this.setStep(auditId, 'plan');
      const recommendations = await this.plan.run({ profile, scoring, competitors });

      await this.markCompleted(auditId, profile, {
        scoring,
        competitors,
        recommendations,
        profileRaw,
        competitorRaw,
      });

      // Email send is non-critical — failures are logged inside EmailService
      // and never roll back the completed audit.
      await this.email.sendAuditComplete({
        to: input.email,
        businessName: profile.businessName,
        auditUrl: `${this.config.get<string>('FRONTEND_URL', '')}/audit/${auditId}`,
        overallScore: scoring.overallScore,
      });
    } catch (err) {
      this.log.error({ err, auditId }, 'Pipeline failed');
      await this.markFailed(auditId, 'failure');
    }
  }

  private async setStep(auditId: string, step: AuditStatusStep): Promise<void> {
    await this.prisma.audit.update({
      where: { id: auditId },
      data: { status: AuditStatus.processing, currentStep: step },
    });
  }

  private async markFailed(auditId: string, errorType: AuditErrorType): Promise<void> {
    await this.prisma.audit.update({
      where: { id: auditId },
      data: { status: AuditStatus.failed, errorType, currentStep: null },
    });
  }

  private async markMultipleMatches(auditId: string, matches: MatchedBusiness[]): Promise<void> {
    // Stay in `processing` but with matchedBusinesses set — the GET handler
    // upgrades this to the `multiple_matches` discriminant.
    await this.prisma.audit.update({
      where: { id: auditId },
      data: {
        status: AuditStatus.processing,
        currentStep: 'find',
        matchedBusinesses: matches as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async markCompleted(
    auditId: string,
    profile: BusinessProfile,
    parts: {
      scoring: import('./types').ScoringResult;
      competitors: import('@/types/audit').CompetitorData[];
      recommendations: import('@/types/audit').AiRecommendation[];
      profileRaw: { googlePlaces: unknown; pageSpeed?: Record<string, unknown> };
      competitorRaw: Record<string, unknown>[];
    },
  ): Promise<void> {
    await this.prisma.audit.update({
      where: { id: auditId },
      data: {
        status: AuditStatus.completed,
        currentStep: null,
        completedAt: new Date(),

        businessName: profile.businessName,
        address: profile.address,
        primaryCategory: profile.primaryCategory,
        isVerified: profile.isVerified,
        isPermanentlyClosed: profile.isPermanentlyClosed,
        hasWebsite: profile.hasWebsite,
        websiteUrl: profile.websiteUrl ?? null,
        websiteLoadTime: profile.websiteLoadTime ?? null,
        mobileFriendly: profile.mobileFriendly ?? null,
        hasEverPosted: profile.hasEverPosted,
        postsSupported: profile.postsSupported,

        overallScore: parts.scoring.overallScore,
        overallRating: parts.scoring.overallRating,
        categoryScores: parts.scoring.categoryScores as unknown as Prisma.InputJsonValue,
        competitors: parts.competitors as unknown as Prisma.InputJsonValue,
        recommendations: parts.recommendations as unknown as Prisma.InputJsonValue,

        selectedPlaceId: profile.placeId,
        rawData: {
          googlePlaces: parts.profileRaw.googlePlaces,
          pageSpeed: parts.profileRaw.pageSpeed,
          competitorPlaces: parts.competitorRaw,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
