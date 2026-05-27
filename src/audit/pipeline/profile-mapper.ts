import { PlaceDetails, PlaceReview } from '@/external/google-places.types';
import { PageSpeedResult } from '@/external/google-pagespeed.service';
import { BusinessProfile } from './types';

/**
 * Loose mapping of Google's `primaryType` token (e.g. `pizza_restaurant`) to
 * a human-readable label. Falls back to the prettified token when missing
 * (`pizza_restaurant` → `Pizza Restaurant`).
 */
const PRIMARY_TYPE_LABELS: Record<string, string> = {
  restaurant: 'Restaurant',
  bar: 'Bar',
  cafe: 'Cafe',
  bakery: 'Bakery',
  lawyer: 'Lawyer',
  dentist: 'Dentist',
  doctor: 'Doctor',
  hair_salon: 'Hair Salon',
  beauty_salon: 'Beauty Salon',
  gym: 'Gym',
  car_repair: 'Auto Repair Shop',
  store: 'Store',
  pizza_restaurant: 'Pizza Restaurant',
};

const POSTS_SUPPORTED_TYPES = new Set<string>([
  'restaurant',
  'bar',
  'cafe',
  'bakery',
  'pizza_restaurant',
  'store',
  'beauty_salon',
  'hair_salon',
  'gym',
]);

export function mapPlaceToProfile(
  place: PlaceDetails,
  pageSpeed: PageSpeedResult | null,
): BusinessProfile {
  const reviews = place.reviews ?? [];
  const responseRate = ownerResponseRate(reviews);
  const recentReview = hasReviewWithin(reviews, 30);
  const photoCount = place.photos?.length ?? 0;
  const recentPhotos = undefined; // Places API does not expose photo upload dates.
  const descriptionLength = place.editorialSummary?.text?.length ?? 0;
  const rawPrimaryType = place.primaryType ?? '';

  return {
    placeId: place.id,
    businessName: place.displayName?.text ?? '',
    address: place.formattedAddress ?? '',
    primaryCategory:
      place.primaryTypeDisplayName?.text ??
      PRIMARY_TYPE_LABELS[rawPrimaryType] ??
      prettify(rawPrimaryType),
    rawPrimaryType,
    isVerified: place.businessStatus === 'OPERATIONAL',
    isPermanentlyClosed: place.businessStatus === 'CLOSED_PERMANENTLY',

    hasWebsite: Boolean(place.websiteUri),
    websiteUrl: place.websiteUri,
    websiteLoadTime: pageSpeed?.speedIndexSeconds,
    mobileFriendly: pageSpeed?.mobileFriendly,
    pageSpeedAvailable: pageSpeed !== null,

    hasPhone: Boolean(place.nationalPhoneNumber),
    hasHours: Boolean(place.regularOpeningHours?.periods?.length),
    descriptionLength,

    photoCount,
    recentPhotos,
    // Heuristic: 10+ photos almost always implies a logo + cover slot
    // exist. Without a richer Places signal we accept this approximation;
    // the scoring item is N/A-able if it ever becomes a real concern.
    hasLogoAndCover: photoCount >= 10,

    reviewCount: place.userRatingCount ?? 0,
    averageRating: place.rating ?? 0,
    reviewResponseRate: responseRate,
    hasRecentReview: recentReview,

    hasEverPosted: false, // Posts are not exposed in the Places API (New).
    postsSupported: POSTS_SUPPORTED_TYPES.has(rawPrimaryType),

    location: place.location,
  };
}

function ownerResponseRate(reviews: PlaceReview[]): number {
  if (reviews.length === 0) return 0;
  // Best-effort heuristic — the Places API (New) doesn't surface owner replies
  // as a structured field. Some markets prefix `(Owner)` in `authorAttribution`;
  // until a richer signal lands, we approximate via that token and otherwise
  // report 0% so the corresponding checklist item fails closed.
  const replies = reviews.filter((r) =>
    /owner/i.test(r.authorAttribution?.displayName ?? ''),
  ).length;
  return replies / reviews.length;
}

function hasReviewWithin(reviews: PlaceReview[], days: number): boolean {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return reviews.some((r) => {
    if (!r.publishTime) return false;
    const t = Date.parse(r.publishTime);
    return Number.isFinite(t) && t >= cutoff;
  });
}

function prettify(token: string): string {
  if (!token) return 'Local Business';
  return token
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
