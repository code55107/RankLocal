import { Injectable } from '@nestjs/common';
import { GooglePlacesService } from '@/external/google-places.service';
import { GooglePagespeedService } from '@/external/google-pagespeed.service';
import { PlaceDetails } from '@/external/google-places.types';
import { BusinessProfile } from '../types';
import { mapPlaceToProfile } from '../profile-mapper';

@Injectable()
export class ProfileService {
  constructor(
    private readonly places: GooglePlacesService,
    private readonly pagespeed: GooglePagespeedService,
  ) {}

  /**
   * Hydrates a `BusinessProfile` for the audited business. The raw Places +
   * PageSpeed payloads are returned alongside so the orchestrator can
   * persist them on the Audit row (`rawData.googlePlaces`, `rawData.pageSpeed`).
   */
  async run(placeId: string): Promise<{
    profile: BusinessProfile;
    raw: { googlePlaces: PlaceDetails; pageSpeed?: Record<string, unknown> };
  }> {
    const details = await this.places.getDetails(placeId);
    const pageSpeed = details.websiteUri ? await this.pagespeed.run(details.websiteUri) : null;
    const profile = mapPlaceToProfile(details, pageSpeed);
    return {
      profile,
      raw: { googlePlaces: details, pageSpeed: pageSpeed?.raw },
    };
  }
}
