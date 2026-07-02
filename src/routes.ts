import { Actor, log } from 'apify';
import type {
  ActorInput,
  ChargeDecision,
  ChargeResultLike,
  MetricResponses,
  RunConfig,
  WebsiteRecord,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.similarweb.com/v1';
export const WEBSITE_SCRAPED_EVENT = 'website-scraped';
const MAX_DOMAINS = 1000;

// ---------------------------------------------------------------------------
// Run state (mirrors the previous actor's atomic-charge + stop-at-limit model)
// ---------------------------------------------------------------------------
let savedWebsiteCount = 0;
let spendingLimitReached = false;
let fatalBillingError: Error | null = null;

export function getSimilarWebRunState(): {
  savedWebsiteCount: number;
  spendingLimitReached: boolean;
  fatalBillingError: Error | null;
} {
  return { savedWebsiteCount, spendingLimitReached, fatalBillingError };
}

export function resetSimilarWebRunState(): void {
  savedWebsiteCount = 0;
  spendingLimitReached = false;
  fatalBillingError = null;
}

/** Thrown when the Similarweb API rejects the API key (fail fast, do not charge). */
export class SimilarwebAuthError extends Error {}

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const n = Number(match[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round(value: number | null, decimals: number): number | null {
  if (value === null) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export function validateDomains(domains: string[]): string[] {
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;
  const valid: string[] = [];
  const seen = new Set<string>();

  for (const raw of domains) {
    if (typeof raw !== 'string') continue;
    const normalized = normalizeDomain(raw);
    if (!normalized || !domainRegex.test(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    valid.push(normalized);
  }

  return valid;
}

export function normalizeMonth(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}`;
}

/** Recent 3-month window ending on the previous complete month (data lags ~1-2 months). */
export function defaultMonthRange(now: Date): { startDate: string; endDate: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 1));
  const fmt = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return { startDate: fmt(start), endDate: fmt(end) };
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  const base = Number.isFinite(n) && n >= 1 ? Math.floor(n) : Math.max(1, fallback);
  return Math.min(MAX_DOMAINS, base);
}

/**
 * Validates and normalizes actor input. Throws immediately (before any network
 * request or billing event) when the API key or domains are missing/invalid.
 */
export function parseConfig(input: ActorInput | null): RunConfig {
  if (!input || typeof input !== 'object') {
    throw new Error('Input is required.');
  }

  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (!apiKey) {
    throw new Error(
      'A Similarweb API key is required. This Actor uses the official Similarweb API (bring your own key) and does not scrape public pages. Add your key in the "Similarweb API key" field.',
    );
  }

  const rawDomains = Array.isArray(input.domains) ? input.domains : [];
  const maxResults = normalizePositiveInt(input.maxResults, rawDomains.length || 1);
  const domains = validateDomains(rawDomains.slice(0, maxResults));
  if (domains.length === 0) {
    throw new Error('No valid domains provided. Add at least one domain such as "openai.com" (without https:// or www.).');
  }

  const country = typeof input.country === 'string' && input.country.trim()
    ? input.country.trim().toLowerCase()
    : 'world';

  let startDate = normalizeMonth(input.startDate);
  let endDate = normalizeMonth(input.endDate);
  if (!startDate || !endDate) {
    const def = defaultMonthRange(new Date());
    startDate = startDate ?? def.startDate;
    endDate = endDate ?? def.endDate;
  }

  return { apiKey, domains, country, startDate, endDate };
}

/** Extracts the latest numeric value from a Similarweb metric series or scalar. */
export function extractLatestNumber(data: unknown, key: string): number | null {
  if (data === null || data === undefined) return null;

  let series: unknown = data;
  if (typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (key in obj) series = obj[key];
  }

  if (Array.isArray(series)) {
    for (let i = series.length - 1; i >= 0; i -= 1) {
      const el = series[i];
      if (el === null || el === undefined) continue;
      const raw = typeof el === 'object'
        ? ((el as Record<string, unknown>)[key] ?? (el as Record<string, unknown>).value)
        : el;
      const n = toNumber(raw);
      if (n !== null) return n;
    }
    return null;
  }

  if (typeof series === 'object') {
    const obj = series as Record<string, unknown>;
    return toNumber(obj.value ?? obj.rank ?? obj[key]);
  }

  return toNumber(series);
}

/** Extracts a rank value from a Similarweb rank endpoint response. */
export function extractRank(data: unknown, key: string): number | null {
  if (data === null || data === undefined) return null;

  let v: unknown = data;
  if (typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (key in obj) v = obj[key];
  }

  if (Array.isArray(v)) {
    for (let i = v.length - 1; i >= 0; i -= 1) {
      const el = v[i];
      if (el && typeof el === 'object') {
        const o = el as Record<string, unknown>;
        const n = toNumber(o.rank ?? o.value ?? o[key]);
        if (n !== null) return n;
      } else {
        const n = toNumber(el);
        if (n !== null) return n;
      }
    }
    return null;
  }

  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return toNumber(o.rank ?? o.value);
  }

  return toNumber(v);
}

/** Reads the category label from a category-rank endpoint response. */
export function extractCategory(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const direct = obj.category;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const cr = obj.category_rank;
  if (cr && typeof cr === 'object') {
    const nested = (cr as Record<string, unknown>).category;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return null;
}

function normalizeBounce(value: number | null): number | null {
  if (value === null) return null;
  const asPercent = value <= 1 ? value * 100 : value;
  return round(asPercent, 1);
}

/** Builds a nullable-safe record from raw API responses. Never invents values. */
export function buildWebsiteRecord(
  domain: string,
  config: Pick<RunConfig, 'country' | 'startDate' | 'endDate'>,
  responses: MetricResponses,
): WebsiteRecord {
  return {
    domain,
    country: config.country,
    startDate: config.startDate,
    endDate: config.endDate,
    globalRank: extractRank(responses.globalRank, 'global_rank'),
    categoryRank: extractRank(responses.categoryRank, 'category_rank'),
    category: extractCategory(responses.categoryRank),
    monthlyVisits: round(extractLatestNumber(responses.visits, 'visits'), 0),
    pagesPerVisit: round(extractLatestNumber(responses.pagesPerVisit, 'pages_per_visit'), 2),
    avgVisitDuration: round(extractLatestNumber(responses.avgVisitDuration, 'average_visit_duration'), 2),
    bounceRate: normalizeBounce(extractLatestNumber(responses.bounceRate, 'bounce_rate')),
    source: 'similarweb-official-api',
    similarWebUrl: `https://www.similarweb.com/website/${domain}/`,
    scrapedAt: new Date().toISOString(),
  };
}

/** True only when at least one real metric was returned by the API. */
export function hasRealMetric(record: WebsiteRecord): boolean {
  return record.globalRank !== null
    || record.categoryRank !== null
    || record.monthlyVisits !== null
    || record.pagesPerVisit !== null
    || record.avgVisitDuration !== null
    || record.bounceRate !== null;
}

/** Atomic-charge decision: charge is coupled to the dataset write. */
export function interpretChargeResult(result: ChargeResultLike): ChargeDecision {
  const limitReached = result.eventChargeLimitReached === true;
  const recordWasSaved = result.chargedCount > 0 || !limitReached;
  return { recordWasSaved, limitReached };
}

// ---------------------------------------------------------------------------
// Network + billing (integration; verified via approved cloud test)
// ---------------------------------------------------------------------------
async function fetchMetric(
  config: RunConfig,
  domain: string,
  endpointPath: string,
  params: Record<string, string | undefined>,
): Promise<{ status: number; data: unknown }> {
  const url = new URL(`${DEFAULT_BASE_URL}/website/${encodeURIComponent(domain)}/${endpointPath}`);
  url.searchParams.set('api_key', config.apiKey);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    log.warning(`Network error calling Similarweb ${endpointPath} for ${domain}: ${(error as Error).message}`);
    return { status: 0, data: null };
  }

  if (response.status === 401) {
    throw new SimilarwebAuthError(
      'Similarweb API rejected the API key (401 Unauthorized). Verify your key is valid, active, and included in this subscription.',
    );
  }

  const text = await response.text().catch(() => '');
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (response.status !== 200) {
    log.warning(`Similarweb ${endpointPath} returned HTTP ${response.status} for ${domain}. This metric will be null.`);
    return { status: response.status, data: null };
  }

  return { status: 200, data };
}

async function saveWebsiteRecord(record: WebsiteRecord): Promise<boolean> {
  try {
    const chargeResult = await Actor.pushData(record, WEBSITE_SCRAPED_EVENT);
    const decision = interpretChargeResult(chargeResult);

    if (decision.recordWasSaved) savedWebsiteCount += 1;

    if (decision.limitReached) {
      spendingLimitReached = true;
      await Actor.setStatusMessage(`Stopped at the user's spending limit after ${savedWebsiteCount} websites`);
      log.info('User spending limit reached; stopping before more SimilarWeb records are saved.');
    }

    return decision.recordWasSaved;
  } catch (error) {
    fatalBillingError = error instanceof Error ? error : new Error(String(error));
    spendingLimitReached = true;
    await Actor.setStatusMessage('Stopped because website output billing failed.');
    log.error(`Stopping SimilarWeb run because dataset push with website-scraped charge failed: ${fatalBillingError.message}`);
    throw fatalBillingError;
  }
}

/**
 * Looks up a single domain via the official Similarweb API and, only when real
 * data is returned, saves and charges one website-scraped event.
 */
export async function scrapeSimilarWebDomain(
  config: RunConfig,
  domain: string,
): Promise<{ saved: boolean; hadData: boolean }> {
  if (fatalBillingError) throw fatalBillingError;
  if (spendingLimitReached) return { saved: false, hadData: false };

  const trafficParams: Record<string, string | undefined> = {
    start_date: config.startDate ?? undefined,
    end_date: config.endDate ?? undefined,
    country: config.country,
    granularity: 'monthly',
    main_domain_only: 'false',
  };
  const rankParams: Record<string, string | undefined> = {
    start_date: config.startDate ?? undefined,
    end_date: config.endDate ?? undefined,
    main_domain_only: 'false',
  };

  // A 401 from any endpoint rejects here and fails the run fast (invalid key).
  const [globalRank, categoryRank, visits, pagesPerVisit, avgVisitDuration, bounceRate] = await Promise.all([
    fetchMetric(config, domain, 'global-rank/global-rank', rankParams),
    fetchMetric(config, domain, 'category-rank/category-rank', rankParams),
    fetchMetric(config, domain, 'total-traffic-and-engagement/visits', trafficParams),
    fetchMetric(config, domain, 'total-traffic-and-engagement/pages-per-visit', trafficParams),
    fetchMetric(config, domain, 'total-traffic-and-engagement/average-visit-duration', trafficParams),
    fetchMetric(config, domain, 'total-traffic-and-engagement/bounce-rate', trafficParams),
  ]);

  const record = buildWebsiteRecord(domain, config, {
    globalRank: globalRank.data,
    categoryRank: categoryRank.data,
    visits: visits.data,
    pagesPerVisit: pagesPerVisit.data,
    avgVisitDuration: avgVisitDuration.data,
    bounceRate: bounceRate.data,
  });

  if (!hasRealMetric(record)) {
    log.warning(
      `Similarweb API returned no usable metrics for ${domain} (check plan coverage, domain spelling, country, or date range). Not saving or charging.`,
    );
    return { saved: false, hadData: false };
  }

  const saved = await saveWebsiteRecord(record);
  log.info(`Saved ${domain}: globalRank=${record.globalRank}, monthlyVisits=${record.monthlyVisits}, bounceRate=${record.bounceRate}`);
  return { saved, hadData: true };
}
