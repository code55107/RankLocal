/**
 * RankLocal — audit contracts.
 *
 * The mock fixture and frontend types in the original Next.js spec ground out
 * here. The Prisma `Audit` row stores most of these shapes verbatim as JSONB
 * (`categoryScores`, `recommendations`, `competitors`, `matchedBusinesses`).
 *
 * Keep this file the single source of truth for any consumer that ships
 * `AuditResult` to the wire.
 */

export type AuditStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type AuditStatusStep = 'find' | 'profile' | 'competitors' | 'scoring' | 'plan';

export type AuditErrorType = 'not-found' | 'timeout' | 'rate-limit' | 'failure';

export type ScoreRating = 'excellent' | 'good' | 'average' | 'poor' | 'critical' | 'na';

export type CategoryKey = 'profile' | 'photos' | 'reviews' | 'technical';

export type Priority = 'high' | 'medium' | 'low';

export type EffortEstimate = string; // free-form, e.g. "30 minutes"

export type ChecklistStatus = 'pass' | 'fail' | 'na';

export interface ChecklistItem {
  id: string;
  label: string;
  passCopy: string;
  failCopy: string;
  status: ChecklistStatus;
  category: CategoryKey;
  values?: Record<string, string | number>;
}

export interface CategoryScore {
  category: CategoryKey;
  label: string;
  score: number;
  maxScore: number;
  rating: ScoreRating;
  weight: number;
  items: ChecklistItem[];
}

export interface AiRecommendation {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  category: CategoryKey;
  expectedImpact: string;
  effort: EffortEstimate;
}

export interface CompetitorSignal {
  label: string;
  comparison: 'better' | 'worse' | 'equal';
}

export interface CompetitorData {
  name: string;
  overallScore: number;
  reviewCount: number;
  averageRating: number;
  signals: CompetitorSignal[];
}

export interface MatchedBusiness {
  id: string; // Google placeId
  name: string;
  address: string;
  category?: string;
}

/** Public, client-facing payload returned by GET /audit/:id when completed. */
export interface AuditResult {
  id: string;
  businessName: string;
  address: string;
  primaryCategory: string;
  isVerified: boolean;
  isPermanentlyClosed: boolean;
  hasWebsite: boolean;
  websiteUrl?: string;
  websiteLoadTime?: number;
  mobileFriendly?: boolean;
  overallScore: number;
  overallRating: ScoreRating;
  categoryScores: CategoryScore[];
  recommendations: AiRecommendation[];
  competitors: CompetitorData[];
  hasEverPosted: boolean;
  postsSupported: boolean;
  createdAt: string;
  completedAt?: string;
}

/** Discriminated union returned by GET /audit/:id. */
export type AuditStatusResponse =
  | { status: 'pending' }
  | { status: 'processing'; currentStep: AuditStatusStep }
  | { status: 'completed'; result: AuditResult }
  | { status: 'failed'; errorType: AuditErrorType }
  | { status: 'multiple_matches'; matches: MatchedBusiness[] };

/** Body accepted by POST /audit (mirrors the frontend form). */
export interface AuditFormInput {
  businessName: string;
  websiteUrl: string;
  location: string;
  email: string;
  phone?: string;
  competitors?: string;
}

export interface AuditSubmitResponse {
  auditId: string;
}
