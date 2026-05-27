import { Injectable, Logger } from '@nestjs/common';
import { GooglePlacesService } from '@/external/google-places.service';
import { FindResult } from '../types';
import { MatchedBusiness } from '@/types/audit';

@Injectable()
export class FindService {
  private readonly log = new Logger(FindService.name);

  constructor(private readonly places: GooglePlacesService) {}

  async run(input: { businessName: string; location: string }): Promise<FindResult> {
    const textQuery = `${input.businessName} ${input.location}`.trim();
    const results = await this.places.searchText(textQuery);

    if (results.length === 0) {
      this.log.debug(`No Places match for "${textQuery}"`);
      return { type: 'not_found' };
    }

    if (results.length === 1) {
      return { type: 'single', placeId: results[0].id };
    }

    const matches: MatchedBusiness[] = results.map((p) => ({
      id: p.id,
      name: p.displayName?.text ?? 'Unknown',
      address: p.formattedAddress ?? '',
      category: p.primaryTypeDisplayName?.text ?? p.primaryType,
    }));
    return { type: 'multiple', matches };
  }
}
