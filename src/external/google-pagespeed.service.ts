import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Slim subset of the PageSpeed Insights v5 response. The full payload is
 * huge — we keep it loose (`Record<string, unknown>`) for storage in
 * `rawData.pageSpeed` and only project the two metrics scoring needs:
 * speed-index (load time) and the mobile accessibility/usability score.
 */
export interface PageSpeedResult {
  raw: Record<string, unknown>;
  /** Speed Index in seconds, derived from `lighthouseResult.audits.speed-index.numericValue / 1000`. */
  speedIndexSeconds?: number;
  /** Mobile-friendly heuristic — `accessibility >= 0.9` OR `seo >= 0.9` passes. */
  mobileFriendly?: boolean;
}

@Injectable()
export class GooglePagespeedService {
  private readonly log = new Logger(GooglePagespeedService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Runs the mobile Lighthouse strategy against `url`. Returns `null` if the
   * API rejects the URL (404, 5xx, quota) so the caller can degrade
   * gracefully to marking technical checklist items as N/A.
   */
  async run(url: string): Promise<PageSpeedResult | null> {
    const key = this.config.getOrThrow<string>('GOOGLE_PAGESPEED_API_KEY');
    const params = new URLSearchParams({
      url,
      strategy: 'mobile',
      key,
    });
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;

    try {
      const res = await fetch(endpoint, { method: 'GET' });
      if (!res.ok) {
        this.log.warn(`PageSpeed failed (${res.status}) for ${url}`);
        return null;
      }
      const raw = (await res.json()) as Record<string, unknown>;
      return {
        raw,
        speedIndexSeconds: this.extractSpeedIndex(raw),
        mobileFriendly: this.extractMobileFriendly(raw),
      };
    } catch (err) {
      this.log.warn(`PageSpeed threw for ${url}: ${(err as Error).message}`);
      return null;
    }
  }

  private extractSpeedIndex(raw: Record<string, unknown>): number | undefined {
    const lh = raw['lighthouseResult'] as Record<string, unknown> | undefined;
    const audits = lh?.['audits'] as Record<string, unknown> | undefined;
    const speedIndex = audits?.['speed-index'] as { numericValue?: number } | undefined;
    if (typeof speedIndex?.numericValue !== 'number') return undefined;
    return speedIndex.numericValue / 1000;
  }

  private extractMobileFriendly(raw: Record<string, unknown>): boolean | undefined {
    const lh = raw['lighthouseResult'] as Record<string, unknown> | undefined;
    const cats = lh?.['categories'] as Record<string, unknown> | undefined;
    const accessibility = (cats?.['accessibility'] as { score?: number } | undefined)?.score;
    const seo = (cats?.['seo'] as { score?: number } | undefined)?.score;
    if (typeof accessibility !== 'number' && typeof seo !== 'number') return undefined;
    return (accessibility ?? 0) >= 0.9 || (seo ?? 0) >= 0.9;
  }
}
