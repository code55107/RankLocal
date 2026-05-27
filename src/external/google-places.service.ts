import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlaceDetails, SearchNearbyResponse, SearchTextResponse } from './google-places.types';

const BASE_URL = 'https://places.googleapis.com/v1';

const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.location',
].join(',');

const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'primaryType',
  'primaryTypeDisplayName',
  'businessStatus',
  'websiteUri',
  'nationalPhoneNumber',
  'regularOpeningHours',
  'editorialSummary',
  'reviews',
  'photos',
  'userRatingCount',
  'rating',
  'googleMapsUri',
  'location',
].join(',');

const NEARBY_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.primaryType',
  'places.location',
  'places.userRatingCount',
  'places.rating',
].join(',');

@Injectable()
export class GooglePlacesService {
  private readonly log = new Logger(GooglePlacesService.name);

  constructor(private readonly config: ConfigService) {}

  /** Text Search (New). Returns 0–n places matching `{businessName} {location}`. */
  async searchText(textQuery: string): Promise<PlaceDetails[]> {
    const response = await this.post<SearchTextResponse>(
      `${BASE_URL}/places:searchText`,
      { textQuery },
      SEARCH_FIELD_MASK,
    );
    return response.places ?? [];
  }

  /** Place Details (New). Throws if `placeId` is unknown. */
  async getDetails(placeId: string): Promise<PlaceDetails> {
    const url = `${BASE_URL}/places/${encodeURIComponent(placeId)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.headers(DETAILS_FIELD_MASK),
    });
    if (!res.ok) {
      const text = await safeText(res);
      this.log.error(`Places details failed (${res.status}): ${text}`);
      throw new Error(`Google Places details failed: ${res.status}`);
    }
    return (await res.json()) as PlaceDetails;
  }

  /**
   * Nearby Search (New). Centered on `location`, 5 km radius. Caller filters
   * out the audited business and ranks by `userRatingCount` to pick top 3.
   */
  async searchNearby(
    primaryType: string,
    location: { latitude: number; longitude: number },
    maxResults = 10,
  ): Promise<PlaceDetails[]> {
    const body = {
      includedTypes: [primaryType],
      maxResultCount: maxResults,
      locationRestriction: {
        circle: { center: location, radius: 5000.0 },
      },
    };
    const response = await this.post<SearchNearbyResponse>(
      `${BASE_URL}/places:searchNearby`,
      body,
      NEARBY_FIELD_MASK,
    );
    return response.places ?? [];
  }

  private async post<T>(url: string, body: unknown, fieldMask: string): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(fieldMask), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await safeText(res);
      this.log.error(`Google Places POST ${url} failed (${res.status}): ${text}`);
      throw new Error(`Google Places request failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private headers(fieldMask: string): Record<string, string> {
    return {
      'X-Goog-Api-Key': this.config.getOrThrow<string>('GOOGLE_PLACES_API_KEY'),
      'X-Goog-FieldMask': fieldMask,
    };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}
