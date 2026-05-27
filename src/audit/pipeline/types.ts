/**
 * Internal pipeline-only types. These never cross the API boundary — the
 * shapes that ship to the client live in `src/types/audit.ts`.
 *
 * A `BusinessProfile` is the normalized projection of a Google Place's
 * details + PageSpeed result. Both the audited business and each competitor
 * are turned into one before scoring runs.
 */

import { CategoryScore, CompetitorData, MatchedBusiness, AuditResult } from '@/types/audit';

export interface BusinessProfile {
  placeId: string;
  businessName: string;
  address: string;
  primaryCategory: string;
  rawPrimaryType: string;
  isVerified: boolean;
  isPermanentlyClosed: boolean;

  hasWebsite: boolean;
  websiteUrl?: string;
  websiteLoadTime?: number;
  mobileFriendly?: boolean;
  pageSpeedAvailable: boolean;

  hasPhone: boolean;
  hasHours: boolean;
  descriptionLength: number;

  photoCount: number;
  recentPhotos: boolean | undefined; // undefined → N/A (no metadata)
  hasLogoAndCover: boolean;

  reviewCount: number;
  averageRating: number;
  reviewResponseRate: number; // 0..1
  hasRecentReview: boolean;

  hasEverPosted: boolean;
  postsSupported: boolean;

  location?: { latitude: number; longitude: number };
}

export interface ScoringResult {
  overallScore: number;
  overallRating: AuditResult['overallRating'];
  categoryScores: CategoryScore[];
}

export type FindResult =
  | { type: 'not_found' }
  | { type: 'single'; placeId: string }
  | { type: 'multiple'; matches: MatchedBusiness[] };

export interface PipelineOutput {
  profile: BusinessProfile;
  scoring: ScoringResult;
  competitors: CompetitorData[];
  recommendations: AuditResult['recommendations'];
  rawData: {
    googlePlaces?: Record<string, unknown>;
    pageSpeed?: Record<string, unknown>;
    competitorPlaces?: Array<Record<string, unknown>>;
  };
}
