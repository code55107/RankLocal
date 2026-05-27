import { Injectable, Logger } from '@nestjs/common';
import { AnthropicService } from '@/external/anthropic.service';
import {
  AiRecommendation,
  CategoryKey,
  ChecklistItem,
  CompetitorData,
  Priority,
} from '@/types/audit';
import { BusinessProfile, ScoringResult } from '../types';

const SYSTEM_PROMPT = `You are a local SEO expert. Given a business's audit scores, failing checklist items,
competitor data, and raw metrics, generate exactly 6 actionable recommendations.

Return a JSON array of 6 objects. Each object must have:
- "title": Short action phrase (imperative, under 60 chars)
- "description": 2-3 sentences explaining what to do and why, with specific numbers from the data
- "priority": "high" | "medium" | "low" (max 3 high, at least 1 low)
- "category": "profile" | "photos" | "reviews" | "technical"
- "expectedImpact": One sentence about expected score improvement
- "effort": Time estimate (e.g. "30 minutes", "1 hour")

Rules:
- Address failing items first, ordered by point value (highest impact first)
- Reference specific numbers from the data (e.g. "You have 4 photos" not "You have few photos")
- If the business has no website, do not include technical recommendations — replace with extra profile/photos/reviews recommendations
- Never recommend paid ads or third-party tools
- Keep language direct and jargon-free
- Return ONLY the JSON array, no markdown or explanation`;

interface RawRecommendation {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  category?: unknown;
  expectedImpact?: unknown;
  effort?: unknown;
}

@Injectable()
export class PlanService {
  private readonly log = new Logger(PlanService.name);

  constructor(private readonly anthropic: AnthropicService) {}

  async run(args: {
    profile: BusinessProfile;
    scoring: ScoringResult;
    competitors: CompetitorData[];
  }): Promise<AiRecommendation[]> {
    const failing = args.scoring.categoryScores
      .flatMap((c) => c.items)
      .filter((i) => i.status === 'fail');

    const userPrompt = buildUserPrompt(args.profile, args.scoring, args.competitors, failing);
    const completion = await this.anthropic.complete({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 2048,
      temperature: 0.3,
    });

    const parsed = completion ? parseAndValidate(completion) : null;
    if (parsed) return parsed;

    this.log.warn('Claude response missing or invalid — falling back to static recommendations');
    return staticFallback(failing, args.profile);
  }
}

function buildUserPrompt(
  profile: BusinessProfile,
  scoring: ScoringResult,
  competitors: CompetitorData[],
  failing: ChecklistItem[],
): string {
  const byCat = (key: CategoryKey): number =>
    scoring.categoryScores.find((c) => c.category === key)?.score ?? 0;

  const failingLines =
    failing.length === 0
      ? '- (none — all items pass)'
      : failing.map((i) => `- [${i.category}] ${i.label}: ${i.failCopy}`).join('\n');

  const competitorLines =
    competitors.length === 0
      ? '- (no competitor data available)'
      : competitors
          .map(
            (c) =>
              `- ${c.name}: ${c.overallScore}/100, ${c.reviewCount} reviews, ${c.averageRating} avg`,
          )
          .join('\n');

  return `Business: ${profile.businessName} (${profile.primaryCategory}) in ${profile.address}
Overall score: ${scoring.overallScore}/100 (${scoring.overallRating})

Category scores:
- Profile: ${byCat('profile')}/100 (weight: 40%)
- Photos: ${byCat('photos')}/100 (weight: 20%)
- Reviews: ${byCat('reviews')}/100 (weight: 25%)
- Technical: ${byCat('technical')}/100 (weight: 15%)

Failing checklist items:
${failingLines}

Key metrics:
- Photo count: ${profile.photoCount}
- Description length: ${profile.descriptionLength} chars
- Review count: ${profile.reviewCount}
- Average rating: ${profile.averageRating}
- Review response rate: ${Math.round(profile.reviewResponseRate * 100)}%
- Website load time: ${profile.websiteLoadTime ?? 'n/a'}s
- Mobile-friendly: ${profile.mobileFriendly ?? 'n/a'}

Top competitors:
${competitorLines}`;
}

function parseAndValidate(raw: string): AiRecommendation[] | null {
  const cleaned = stripCodeFence(raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 6) return null;

  const out: AiRecommendation[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i] as RawRecommendation;
    if (
      typeof r.title !== 'string' ||
      r.title.length > 60 ||
      typeof r.description !== 'string' ||
      !isPriority(r.priority) ||
      !isCategory(r.category) ||
      typeof r.expectedImpact !== 'string' ||
      typeof r.effort !== 'string'
    ) {
      return null;
    }
    out.push({
      id: `rec-${i + 1}`,
      title: r.title,
      description: r.description,
      priority: r.priority,
      category: r.category,
      expectedImpact: r.expectedImpact,
      effort: r.effort,
    });
  }
  return out;
}

function stripCodeFence(s: string): string {
  // Some models still wrap JSON in ```json fences despite the prompt.
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}

function isPriority(v: unknown): v is Priority {
  return v === 'high' || v === 'medium' || v === 'low';
}

function isCategory(v: unknown): v is CategoryKey {
  return v === 'profile' || v === 'photos' || v === 'reviews' || v === 'technical';
}

/**
 * Static template fallback when Claude is unreachable or returns an invalid
 * shape. Builds up to 6 recommendations from the highest-impact failing items
 * first, then pads with generic best-practice tips per category.
 */
function staticFallback(failing: ChecklistItem[], profile: BusinessProfile): AiRecommendation[] {
  const pointsById: Record<string, number> = {
    'profile-1': 20,
    'profile-2': 20,
    'profile-3': 20,
    'profile-4': 20,
    'profile-5': 20,
    'photos-1': 40,
    'photos-2': 25,
    'photos-3': 35,
    'reviews-1': 30,
    'reviews-2': 25,
    'reviews-3': 20,
    'reviews-4': 25,
    'technical-1': 35,
    'technical-2': 35,
    'technical-3': 30,
  };
  const sorted = [...failing].sort((a, b) => (pointsById[b.id] ?? 0) - (pointsById[a.id] ?? 0));

  const out: AiRecommendation[] = [];
  for (const item of sorted) {
    if (out.length >= 6) break;
    out.push(templateForItem(item, out.length));
  }
  // Pad with generic boosters until we hit 6 — keeping at least 1 low priority.
  const filler: Omit<AiRecommendation, 'id'>[] = [
    {
      title: 'Post a weekly update on your Google profile',
      description:
        'Google Posts keep your listing looking active. Even a short weekly note (offer, event, hours change) signals freshness.',
      priority: 'medium',
      category: 'profile',
      expectedImpact: 'Improves perceived freshness and engagement signals.',
      effort: '15 minutes',
    },
    {
      title: 'Encourage customers to leave reviews',
      description:
        'Hand out a short-link or QR code that points to your Google review form. Even 1 new review per week compounds quickly.',
      priority: 'low',
      category: 'reviews',
      expectedImpact: 'Lifts review count and recency over time.',
      effort: '30 minutes',
    },
    {
      title: 'Refresh your top-3 photos',
      description: `You currently have ${profile.photoCount} photos. Re-shoot the top three in good daylight to make a stronger first impression.`,
      priority: 'low',
      category: 'photos',
      expectedImpact: 'Increases click-throughs from search.',
      effort: '1 hour',
    },
  ];
  for (const f of filler) {
    if (out.length >= 6) break;
    out.push({ id: `rec-${out.length + 1}`, ...f });
  }
  return out.slice(0, 6).map((rec, i) => ({ ...rec, id: `rec-${i + 1}` }));
}

function templateForItem(item: ChecklistItem, index: number): AiRecommendation {
  const priority: Priority = index < 3 ? 'high' : index < 5 ? 'medium' : 'low';
  return {
    id: `rec-${index + 1}`,
    title: shorten(`Fix: ${item.label}`, 60),
    description: item.failCopy,
    priority,
    category: item.category,
    expectedImpact: `Lifts your ${item.category} score by closing the "${item.label}" gap.`,
    effort: '30 minutes',
  };
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
