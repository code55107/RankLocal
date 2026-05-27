import { Injectable, Logger } from '@nestjs/common';
import { GooglePlacesService } from '@/external/google-places.service';
import { GooglePagespeedService } from '@/external/google-pagespeed.service';
import { PlaceDetails } from '@/external/google-places.types';
import { CompetitorData, CompetitorSignal } from '@/types/audit';
import { BusinessProfile } from '../types';
import { mapPlaceToProfile } from '../profile-mapper';
import { ScoringService } from './scoring.service';

@Injectable()
export class CompetitorsService {
  private readonly log = new Logger(CompetitorsService.name);

  constructor(
    private readonly places: GooglePlacesService,
    private readonly pagespeed: GooglePagespeedService,
    private readonly scoring: ScoringService,
  ) {}

  /**
   * Finds top 3 competitors near `profile.location`, hydrates each into a
   * full profile, runs the deterministic scoring engine against them, and
   * emits per-competitor comparison signals.
   *
   * Failures are non-fatal: if Nearby Search or any individual competitor
   * fetch throws, the step returns `[]` rather than failing the audit. The
   * orchestrator surfaces the partial result on the final response.
   */
  async run(
    profile: BusinessProfile,
  ): Promise<{ competitors: CompetitorData[]; raw: Record<string, unknown>[] }> {
    if (!profile.location || !profile.rawPrimaryType) {
      this.log.debug('No location or primaryType — skipping competitors');
      return { competitors: [], raw: [] };
    }

    let nearby: PlaceDetails[] = [];
    try {
      nearby = await this.places.searchNearby(profile.rawPrimaryType, profile.location, 10);
    } catch (err) {
      this.log.warn(`Nearby search failed: ${(err as Error).message}`);
      return { competitors: [], raw: [] };
    }

    const filtered = nearby
      .filter((p) => p.id !== profile.placeId)
      .sort((a, b) => (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0))
      .slice(0, 3);

    const competitors: CompetitorData[] = [];
    const raw: Record<string, unknown>[] = [];

    for (const candidate of filtered) {
      try {
        const details = await this.places.getDetails(candidate.id);
        const pageSpeed = details.websiteUri ? await this.pagespeed.run(details.websiteUri) : null;
        const compProfile = mapPlaceToProfile(details, pageSpeed);
        const scoring = this.scoring.run(compProfile);
        competitors.push({
          name: compProfile.businessName,
          overallScore: scoring.overallScore,
          reviewCount: compProfile.reviewCount,
          averageRating: round1(compProfile.averageRating),
          signals: buildSignals(profile, compProfile),
        });
        raw.push(details as unknown as Record<string, unknown>);
      } catch (err) {
        this.log.warn(`Competitor ${candidate.id} failed: ${(err as Error).message}`);
      }
    }

    return { competitors, raw };
  }
}

/** Build at most 3 most-impactful comparison signals (spec §6.6). */
function buildSignals(self: BusinessProfile, comp: BusinessProfile): CompetitorSignal[] {
  const raw: CompetitorSignal[] = [];

  pushIfDiff(
    raw,
    comp.photoCount,
    self.photoCount,
    'More photos uploaded',
    'Fewer photos uploaded',
  );
  pushIfDiff(
    raw,
    comp.reviewResponseRate,
    self.reviewResponseRate,
    'Higher review response rate',
    'Lower review response rate',
  );
  if (comp.hasWebsite && self.hasWebsite) {
    pushIfDiff(
      raw,
      // Lower load time is better, so invert by negating for the comparator.
      -(comp.websiteLoadTime ?? Number.POSITIVE_INFINITY),
      -(self.websiteLoadTime ?? Number.POSITIVE_INFINITY),
      'Faster website load time',
      'Slower website load time',
    );
  }
  pushBool(
    raw,
    comp.hasHours,
    self.hasHours,
    'Complete business hours',
    'Incomplete business hours',
  );
  pushBool(
    raw,
    comp.descriptionLength >= 250,
    self.descriptionLength >= 250,
    'Full business description',
    'Missing business description',
  );
  if (comp.mobileFriendly !== undefined && self.mobileFriendly !== undefined) {
    pushBool(
      raw,
      comp.mobileFriendly,
      self.mobileFriendly,
      'Mobile-friendly website',
      'Not mobile-friendly',
    );
  }
  pushIfDiff(raw, comp.reviewCount, self.reviewCount, 'More total reviews', 'Fewer total reviews');
  pushIfDiff(
    raw,
    comp.averageRating,
    self.averageRating,
    'Higher average rating',
    'Lower average rating',
  );

  // Spec: limit to 3 most impactful — we approximate impact by signal order
  // above (descriptive of audit value), keeping only the first 3 non-equal.
  return raw.filter((s) => s.comparison !== 'equal').slice(0, 3);
}

function pushIfDiff(
  out: CompetitorSignal[],
  comp: number,
  self: number,
  betterLabel: string,
  worseLabel: string,
): void {
  if (comp > self) out.push({ label: betterLabel, comparison: 'better' });
  else if (comp < self) out.push({ label: worseLabel, comparison: 'worse' });
  else out.push({ label: betterLabel, comparison: 'equal' });
}

function pushBool(
  out: CompetitorSignal[],
  comp: boolean,
  self: boolean,
  betterLabel: string,
  worseLabel: string,
): void {
  if (comp === self) out.push({ label: betterLabel, comparison: 'equal' });
  else if (comp) out.push({ label: betterLabel, comparison: 'better' });
  else out.push({ label: worseLabel, comparison: 'worse' });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
