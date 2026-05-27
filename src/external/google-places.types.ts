/**
 * Subset of the Google Places API (New) response shapes RankLocal actually
 * reads. Kept here so the rest of the code can stay typed against narrow
 * structures without pulling in a heavyweight client library.
 *
 * Full schemas:
 *   https://developers.google.com/maps/documentation/places/web-service/data-fields
 */

export interface PlaceDisplayName {
  text: string;
  languageCode?: string;
}

export interface PlacePhoto {
  name: string;
  widthPx?: number;
  heightPx?: number;
  authorAttributions?: Array<{ displayName: string; uri?: string; photoUri?: string }>;
}

export interface PlaceReview {
  name: string;
  rating?: number;
  text?: { text: string; languageCode?: string };
  publishTime?: string; // ISO 8601
  authorAttribution?: { displayName: string };
  // Owner responses are surfaced as `authorAttribution.displayName === '(Owner)'`
  // in some markets, or via a separate `originalText`. Detection lives in
  // profile.ts so the shape can stay loose here.
}

export interface PlaceOpeningHours {
  openNow?: boolean;
  periods?: Array<{
    open?: { day: number; hour: number; minute: number };
    close?: { day: number; hour: number; minute: number };
  }>;
  weekdayDescriptions?: string[];
}

export interface PlaceLocation {
  latitude: number;
  longitude: number;
}

export type BusinessStatus =
  | 'OPERATIONAL'
  | 'CLOSED_TEMPORARILY'
  | 'CLOSED_PERMANENTLY'
  | 'BUSINESS_STATUS_UNSPECIFIED';

export interface PlaceDetails {
  id: string;
  displayName?: PlaceDisplayName;
  formattedAddress?: string;
  primaryType?: string;
  primaryTypeDisplayName?: PlaceDisplayName;
  businessStatus?: BusinessStatus;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: PlaceOpeningHours;
  editorialSummary?: { text: string; languageCode?: string };
  reviews?: PlaceReview[];
  photos?: PlacePhoto[];
  userRatingCount?: number;
  rating?: number;
  googleMapsUri?: string;
  location?: PlaceLocation;
}

export interface SearchTextResponse {
  places?: PlaceDetails[];
}

export interface SearchNearbyResponse {
  places?: PlaceDetails[];
}
