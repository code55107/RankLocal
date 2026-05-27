import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { RateLimitService } from './rate-limit.service';
import { AuditCleanupService } from './audit-cleanup.service';
import { AuditPipelineService } from './pipeline/audit-pipeline.service';
import { FindService } from './pipeline/steps/find.service';
import { ProfileService } from './pipeline/steps/profile.service';
import { CompetitorsService } from './pipeline/steps/competitors.service';
import { ScoringService } from './pipeline/steps/scoring.service';
import { PlanService } from './pipeline/steps/plan.service';
import { EmailModule } from '@/email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [AuditController],
  providers: [
    AuditService,
    RateLimitService,
    AuditCleanupService,
    AuditPipelineService,
    FindService,
    ProfileService,
    CompetitorsService,
    ScoringService,
    PlanService,
  ],
  exports: [AuditService],
})
export class AuditModule {}
