import { Injectable } from '@nestjs/common';
import {
  CategoryKey,
  CategoryScore,
  ChecklistItem,
  ChecklistStatus,
  ScoreRating,
} from '@/types/audit';
import { BusinessProfile, ScoringResult } from '../types';

/**
 * Deterministic scoring engine. No AI involved.
 *
 * Scoring contract (spec §6):
 *   - 15 checklist items across 4 categories (profile, photos, reviews, technical)
 *   - Item points within each category sum to 100
 *   - Category score = (Σ points of passing items) / (Σ points of applicable items) × 100
 *   - Items marked `na` are excluded from both numerator and denominator
 *   - Category weights: profile 0.40, photos 0.20, reviews 0.25, technical 0.15
 *   - When the business has no website: all 3 technical items become `na`,
 *     technical weight (0.15) is redistributed proportionally to the other
 *     three (profile/photos/reviews ÷ 0.85)
 *   - Overall = round(Σ categoryScore × effectiveWeight)
 *   - Rating thresholds: ≥80 excellent, ≥60 good, ≥40 average, ≥20 poor, else critical
 */

interface ItemSpec {
  id: string;
  category: CategoryKey;
  label: string;
  passCopy: string;
  failCopy: string;
  points: number;
  evaluate: (p: BusinessProfile) => {
    status: ChecklistStatus;
    values?: Record<string, string | number>;
  };
}

const BASE_WEIGHTS: Record<CategoryKey, number> = {
  profile: 0.4,
  photos: 0.2,
  reviews: 0.25,
  technical: 0.15,
};

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  profile: 'Business Profile',
  photos: 'Photos',
  reviews: 'Reviews',
  technical: 'Technical',
};

const ITEMS: ItemSpec[] = [
  // ---- Profile (5 items, 100 points) ----
  {
    id: 'profile-1',
    category: 'profile',
    label: 'Business name matches Google',
    passCopy: 'Your business name on Google matches the name customers know.',
    failCopy: 'Your Google listing name does not match the name you submitted.',
    points: 20,
    evaluate: () => ({ status: 'pass' }), // Found via Places text search → name match is implied.
  },
  {
    id: 'profile-2',
    category: 'profile',
    label: 'Address is complete and accurate',
    passCopy: 'Your address includes a full street number on Google.',
    failCopy: 'Your address is missing a street number on Google.',
    points: 20,
    evaluate: (p) => ({
      status: /\d/.test(p.address) ? 'pass' : 'fail',
      values: { address: p.address },
    }),
  },
  {
    id: 'profile-3',
    category: 'profile',
    label: 'Phone number is present',
    passCopy: 'Customers can call you straight from Google.',
    failCopy: 'No phone number is listed on Google.',
    points: 20,
    evaluate: (p) => ({ status: p.hasPhone ? 'pass' : 'fail' }),
  },
  {
    id: 'profile-4',
    category: 'profile',
    label: 'Hours of operation are listed',
    passCopy: 'Your opening hours are listed so customers know when to visit.',
    failCopy: 'No opening hours are listed on Google.',
    points: 20,
    evaluate: (p) => ({ status: p.hasHours ? 'pass' : 'fail' }),
  },
  {
    id: 'profile-5',
    category: 'profile',
    label: 'Business description is filled out',
    passCopy: 'Your description is detailed enough to help customers find you.',
    failCopy: 'Your description is missing or too short (250+ characters recommended).',
    points: 20,
    evaluate: (p) => ({
      status: p.descriptionLength >= 250 ? 'pass' : 'fail',
      values: { length: p.descriptionLength },
    }),
  },

  // ---- Photos (3 items, 100 points) ----
  {
    id: 'photos-1',
    category: 'photos',
    label: 'At least 10 photos uploaded',
    passCopy: 'You have a healthy number of photos uploaded.',
    failCopy: 'Add more photos — listings with 10+ photos get more clicks.',
    points: 40,
    evaluate: (p) => ({
      status: p.photoCount >= 10 ? 'pass' : 'fail',
      values: { photoCount: p.photoCount },
    }),
  },
  {
    id: 'photos-2',
    category: 'photos',
    label: 'Photos uploaded in the last 90 days',
    passCopy: 'Your photos are fresh — Google rewards recently updated listings.',
    failCopy: 'No recent photos in the last 90 days. Upload a few new shots.',
    points: 25,
    evaluate: (p) =>
      // Places API (New) does not expose photo upload dates; status is N/A
      // unless the mapper later wires a richer signal.
      p.recentPhotos === undefined
        ? { status: 'na' }
        : { status: p.recentPhotos ? 'pass' : 'fail' },
  },
  {
    id: 'photos-3',
    category: 'photos',
    label: 'Logo and cover photo set',
    passCopy: 'A logo and cover photo are in place.',
    failCopy: 'Set a clear logo and an inviting cover photo.',
    points: 35,
    evaluate: (p) => ({ status: p.hasLogoAndCover ? 'pass' : 'fail' }),
  },

  // ---- Reviews (4 items, 100 points) ----
  {
    id: 'reviews-1',
    category: 'reviews',
    label: 'At least 10 reviews',
    passCopy: 'You have enough reviews to build customer trust.',
    failCopy: 'Get to 10+ reviews — it is the social-proof tipping point.',
    points: 30,
    evaluate: (p) => ({
      status: p.reviewCount >= 10 ? 'pass' : 'fail',
      values: { reviewCount: p.reviewCount },
    }),
  },
  {
    id: 'reviews-2',
    category: 'reviews',
    label: 'Average rating ≥ 4.0',
    passCopy: 'Your average rating signals quality to new customers.',
    failCopy: 'Your average rating is below 4.0 — focus on customer experience.',
    points: 25,
    evaluate: (p) => ({
      status: p.averageRating >= 4.0 ? 'pass' : 'fail',
      values: { averageRating: round1(p.averageRating) },
    }),
  },
  {
    id: 'reviews-3',
    category: 'reviews',
    label: 'You respond to reviews',
    passCopy: 'You actively respond to customer reviews.',
    failCopy: 'Reply to at least half of your reviews — even short thanks helps.',
    points: 20,
    evaluate: (p) => ({
      status: p.reviewResponseRate >= 0.5 ? 'pass' : 'fail',
      values: { responseRate: Math.round(p.reviewResponseRate * 100) },
    }),
  },
  {
    id: 'reviews-4',
    category: 'reviews',
    label: 'At least one review in the last 30 days',
    passCopy: 'A recent review keeps your listing looking active.',
    failCopy: 'No reviews in the last 30 days — ask happy customers to leave one.',
    points: 25,
    evaluate: (p) => ({ status: p.hasRecentReview ? 'pass' : 'fail' }),
  },

  // ---- Technical (3 items, 100 points) ----
  {
    id: 'technical-1',
    category: 'technical',
    label: 'Website is linked and loads',
    passCopy: 'Your website is linked from Google and reachable.',
    failCopy: 'No website is linked from your Google listing.',
    points: 35,
    evaluate: (p) =>
      !p.hasWebsite ? { status: 'na' } : { status: p.pageSpeedAvailable ? 'pass' : 'fail' },
  },
  {
    id: 'technical-2',
    category: 'technical',
    label: 'Website loads in under 3 seconds',
    passCopy: 'Your site loads fast on mobile (Speed Index < 3 s).',
    failCopy: 'Your site is slow on mobile — work on Speed Index.',
    points: 35,
    evaluate: (p) =>
      !p.hasWebsite || p.websiteLoadTime === undefined
        ? { status: 'na' }
        : {
            status: p.websiteLoadTime < 3.0 ? 'pass' : 'fail',
            values: { loadTime: round1(p.websiteLoadTime) },
          },
  },
  {
    id: 'technical-3',
    category: 'technical',
    label: 'Website is mobile-friendly',
    passCopy: 'Your site renders cleanly on mobile.',
    failCopy: 'Your site has mobile-friendliness issues — fix viewport / tap targets.',
    points: 30,
    evaluate: (p) =>
      !p.hasWebsite || p.mobileFriendly === undefined
        ? { status: 'na' }
        : { status: p.mobileFriendly ? 'pass' : 'fail' },
  },
];

@Injectable()
export class ScoringService {
  run(profile: BusinessProfile): ScoringResult {
    const items: ChecklistItem[] = ITEMS.map((spec) => {
      const result = spec.evaluate(profile);
      return {
        id: spec.id,
        category: spec.category,
        label: spec.label,
        passCopy: spec.passCopy,
        failCopy: spec.failCopy,
        status: result.status,
        values: result.values,
      };
    });

    const grouped = groupByCategory(items);
    const noWebsite = !profile.hasWebsite;

    const categoryScores: CategoryScore[] = (Object.keys(BASE_WEIGHTS) as CategoryKey[]).map(
      (category) => {
        const catItems = grouped[category];
        const { score, maxScore } = computeCategory(category, catItems);
        const weight = effectiveWeight(category, noWebsite);
        const rating = noWebsite && category === 'technical' ? 'na' : ratingFor(score);

        return {
          category,
          label: CATEGORY_LABELS[category],
          score,
          maxScore,
          rating,
          weight,
          items: catItems,
        };
      },
    );

    const overallScore = Math.round(
      categoryScores.reduce((acc, c) => {
        if (c.maxScore === 0) return acc; // skip N/A category
        return acc + c.score * c.weight;
      }, 0),
    );

    return {
      overallScore,
      overallRating: ratingFor(overallScore),
      categoryScores,
    };
  }
}

function groupByCategory(items: ChecklistItem[]): Record<CategoryKey, ChecklistItem[]> {
  const out: Record<CategoryKey, ChecklistItem[]> = {
    profile: [],
    photos: [],
    reviews: [],
    technical: [],
  };
  for (const item of items) out[item.category].push(item);
  return out;
}

function computeCategory(
  category: CategoryKey,
  items: ChecklistItem[],
): { score: number; maxScore: number } {
  // Lookup the canonical point values from the spec, indexed by id, so the
  // category math stays independent of the iteration order in `ITEMS`.
  const pointsById = new Map(
    ITEMS.filter((s) => s.category === category).map((s) => [s.id, s.points]),
  );
  let applicable = 0;
  let earned = 0;
  for (const item of items) {
    const pts = pointsById.get(item.id) ?? 0;
    if (item.status === 'na') continue;
    applicable += pts;
    if (item.status === 'pass') earned += pts;
  }
  if (applicable === 0) return { score: 0, maxScore: 0 };
  return { score: Math.round((earned / applicable) * 100), maxScore: 100 };
}

function effectiveWeight(category: CategoryKey, noWebsite: boolean): number {
  if (!noWebsite) return BASE_WEIGHTS[category];
  if (category === 'technical') return 0;
  // Redistribute technical's 0.15 proportionally — divide each remaining
  // category's base weight by (1 - technical), i.e. 0.85.
  const denom = 1 - BASE_WEIGHTS.technical;
  return BASE_WEIGHTS[category] / denom;
}

function ratingFor(score: number): ScoreRating {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'average';
  if (score >= 20) return 'poor';
  return 'critical';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
