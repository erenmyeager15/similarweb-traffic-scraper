export interface ActorInput {
  apiKey?: string;
  domains?: string[];
  maxResults?: number;
  country?: string;
  startDate?: string;
  endDate?: string;
}

export interface RunConfig {
  apiKey: string;
  domains: string[];
  country: string;
  startDate: string | null;
  endDate: string | null;
}

/**
 * Raw per-metric API responses collected for a single domain. Each field holds
 * whatever the official Similarweb endpoint returned (or undefined/null if that
 * endpoint failed, is not in the caller's plan, or returned no data).
 */
export interface MetricResponses {
  globalRank?: unknown;
  categoryRank?: unknown;
  visits?: unknown;
  pagesPerVisit?: unknown;
  avgVisitDuration?: unknown;
  bounceRate?: unknown;
}

export interface WebsiteRecord {
  domain: string;
  country: string;
  startDate: string | null;
  endDate: string | null;
  globalRank: number | null;
  categoryRank: number | null;
  category: string | null;
  monthlyVisits: number | null;
  pagesPerVisit: number | null;
  avgVisitDuration: number | null;
  bounceRate: number | null;
  source: 'similarweb-official-api';
  similarWebUrl: string;
  scrapedAt: string;
}

export interface ChargeResultLike {
  chargedCount: number;
  eventChargeLimitReached?: boolean;
}

export interface ChargeDecision {
  recordWasSaved: boolean;
  limitReached: boolean;
}
