import { afterEach, describe, expect, it, vi } from 'vitest';
import { Actor, log } from 'apify';
import {
  buildWebsiteRecord,
  defaultMonthRange,
  extractLatestNumber,
  hasRealMetric,
  interpretChargeResult,
  parseConfig,
  normalizeMonth,
  resetSimilarWebRunState,
  scrapeSimilarWebDomain,
  getSimilarWebRunState,
} from './routes.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetSimilarWebRunState(); });

describe('parseConfig (fail fast before network/billing)', () => {
  it('throws when the API key is missing', () => {
    expect(() => parseConfig({ domains: ['openai.com'] })).toThrowError(/API key/i);
  });

  it('throws when no valid domains are provided', () => {
    expect(() => parseConfig({ apiKey: 'k', domains: ['!!!not a domain!!!'] })).toThrowError(/domain/i);
  });

  it('normalizes a valid key, domain, and country', () => {
    const cfg = parseConfig({
      apiKey: '  my-key ',
      domains: ['HTTPS://WWW.OpenAI.com/pricing'],
      country: 'US',
      maxResults: 5,
    });
    expect(cfg.apiKey).toBe('my-key');
    expect(cfg.domains).toEqual(['openai.com']);
    expect(cfg.country).toBe('us');
    expect(cfg.startDate).toMatch(/^\d{4}-\d{2}$/);
    expect(cfg.endDate).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('buildWebsiteRecord (maps official API responses)', () => {
  const cfg = { country: 'world', startDate: '2026-03', endDate: '2026-05' } as const;

  it('maps rank, category, visits, and engagement to output fields', () => {
    const record = buildWebsiteRecord('openai.com', cfg, {
      globalRank: { global_rank: { rank: 201 } },
      categoryRank: { category: 'Computers_Electronics_and_Technology', category_rank: { rank: 6 } },
      visits: { visits: [{ date: '2026-04-01', visits: 203000000 }, { date: '2026-05-01', visits: 210500000 }] },
      pagesPerVisit: { pages_per_visit: [{ date: '2026-05-01', pages_per_visit: 2.81 }] },
      avgVisitDuration: { average_visit_duration: [{ date: '2026-05-01', average_visit_duration: 144.79 }] },
      bounceRate: { bounce_rate: [{ date: '2026-05-01', bounce_rate: 0.582 }] },
    });

    expect(record).toMatchObject({
      domain: 'openai.com',
      country: 'world',
      startDate: '2026-03',
      endDate: '2026-05',
      globalRank: 201,
      categoryRank: 6,
      category: 'Computers_Electronics_and_Technology',
      monthlyVisits: 210500000,
      pagesPerVisit: 2.81,
      avgVisitDuration: 144.79,
      bounceRate: 58.2,
      source: 'similarweb-official-api',
      similarWebUrl: 'https://www.similarweb.com/website/openai.com/',
    });
    expect(typeof record.scrapedAt).toBe('string');
    expect(hasRealMetric(record)).toBe(true);
  });

  it('never fabricates values on API error/empty responses (no fake rows)', () => {
    const record = buildWebsiteRecord('unknown-domain-xyz.com', cfg, {
      globalRank: null,
      categoryRank: { error: 'Forbidden' },
      visits: {},
      pagesPerVisit: undefined,
      avgVisitDuration: null,
      bounceRate: { bounce_rate: [] },
    });

    expect(record.globalRank).toBeNull();
    expect(record.categoryRank).toBeNull();
    expect(record.category).toBeNull();
    expect(record.monthlyVisits).toBeNull();
    expect(record.pagesPerVisit).toBeNull();
    expect(record.avgVisitDuration).toBeNull();
    expect(record.bounceRate).toBeNull();
    expect(hasRealMetric(record)).toBe(false);
  });
});

describe('interpretChargeResult (atomic charge + stop-at-limit)', () => {
  it('counts a charged row and keeps going', () => {
    expect(interpretChargeResult({ chargedCount: 1, eventChargeLimitReached: false }))
      .toEqual({ recordWasSaved: true, limitReached: false });
  });

  it('stops and does not count when the charge limit is reached with no charge', () => {
    expect(interpretChargeResult({ chargedCount: 0, eventChargeLimitReached: true }))
      .toEqual({ recordWasSaved: false, limitReached: true });
  });

  it('still counts a saved row when not charged but the limit is not reached (pre-pricing)', () => {
    expect(interpretChargeResult({ chargedCount: 0, eventChargeLimitReached: false }))
      .toEqual({ recordWasSaved: true, limitReached: false });
  });
});

describe('extractLatestNumber', () => {
  it('takes the latest value from a Similarweb series', () => {
    expect(extractLatestNumber({ visits: [{ date: '2026-04-01', visits: 100 }, { date: '2026-05-01', visits: 200 }] }, 'visits')).toBe(200);
  });

  it('returns null for empty or missing series', () => {
    expect(extractLatestNumber({ visits: [] }, 'visits')).toBeNull();
    expect(extractLatestNumber(null, 'visits')).toBeNull();
  });
});

describe('defaultMonthRange', () => {
  it('returns a 3-month window ending on the previous month', () => {
    const range = defaultMonthRange(new Date(Date.UTC(2026, 5, 15))); // June 2026
    expect(range.endDate).toBe('2026-05');
    expect(range.startDate).toBe('2026-03');
  });
});

describe('API input and metric hardening', () => {
  it('applies the domain limit after filtering and deduplication', () => {
    expect(parseConfig({ apiKey: 'k', domains: ['bad', 'example.com', 'example.com', 'example.net'], maxResults: 2 }).domains).toEqual(['example.com', 'example.net']);
  });
  it.each([0, -1, 1001, 1.5, '2', NaN, Infinity])('rejects invalid API maxResults %j', (maxResults) => {
    expect(() => parseConfig({ apiKey: 'k', domains: ['example.com'], maxResults: maxResults as number })).toThrow(/maxResults/);
  });
  it.each(['usa', 'United States', 'us&api_key=secret'])('rejects invalid country %s', (country) => {
    expect(() => parseConfig({ apiKey: 'k', domains: ['example.com'], country })).toThrow(/country/);
  });
  it.each(['2026-13', '2026-09garbage', '2026-02-30', '0000-01'])('rejects invalid explicit API dates %s', (startDate) => {
    expect(normalizeMonth(startDate)).toBeNull();
    expect(() => parseConfig({ apiKey: 'k', domains: ['example.com'], startDate })).toThrow(/dates/);
  });
  it('rejects reversed API periods before using credits', () => {
    expect(() => parseConfig({ apiKey: 'k', domains: ['example.com'], startDate: '2026-09', endDate: '2026-08' })).toThrow(/later/);
  });
  it.each(['12M', 'error 429', '100 apples', '1,23', '=100+5', ''])('does not parse error or abbreviated strings as numeric data %j', (visits) => {
    expect(extractLatestNumber({ visits }, 'visits')).toBeNull();
  });
  it('handles explicit null metric series safely', () => expect(extractLatestNumber({ visits: null }, 'visits')).toBeNull());
  it('preserves numeric zero and grouped numeric strings', () => {
    expect(extractLatestNumber({ visits: '1,234' }, 'visits')).toBe(1234);
    expect(extractLatestNumber({ visits: 0 }, 'visits')).toBe(0);
  });
  it('excludes impossible response metrics instead of creating fake billable data', () => {
    const record = buildWebsiteRecord('example.com', { country: 'us', startDate: '2026-08', endDate: '2026-09' }, {
      globalRank: { global_rank: 0 }, categoryRank: { category_rank: 1.5 }, visits: { visits: -10 },
      pagesPerVisit: { pages_per_visit: -1 }, avgVisitDuration: { average_visit_duration: 100000 }, bounceRate: { bounce_rate: 101 },
    });
    expect(hasRealMetric(record)).toBe(false);
  });
});

function mockApiRuntime(remaining = 10) {
  const count = vi.fn(() => remaining);
  vi.spyOn(Actor, 'getChargingManager').mockReturnValue({ calculateMaxEventChargeCountWithinLimit: count } as unknown as ReturnType<typeof Actor.getChargingManager>);
  const save = vi.spyOn(Actor, 'pushData').mockResolvedValue({ chargedCount: 1, eventChargeLimitReached: false });
  vi.spyOn(Actor, 'setStatusMessage').mockResolvedValue(undefined);
  const warning = vi.spyOn(log, 'warning').mockImplementation(() => undefined);
  vi.spyOn(log, 'info').mockImplementation(() => undefined);
  vi.spyOn(log, 'error').mockImplementation(() => undefined);
  return { count, save, warning };
}
const apiConfig = { apiKey: 'SYNTHETIC_PRIVATE_KEY', domains: ['example.com'], country: 'us', startDate: '2026-08', endDate: '2026-09' };

describe('mocked API access, timeout and atomic-billing safeguards', () => {
  it('checks the remaining result budget before consuming external API credits', async () => {
    const { save } = mockApiRuntime(0);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await scrapeSimilarWebDomain(apiConfig, 'example.com')).toEqual({ saved: false, hadData: false });
    expect(fetch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect(getSimilarWebRunState().spendingLimitReached).toBe(true);
  });
  it('uses six bounded requests, one saved-domain event and no retry for valid data', async () => {
    const { save } = mockApiRuntime();
    const fetch = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ visits: [{ visits: 1000 }], global_rank: { rank: 100 }, category_rank: { rank: 5 },
        pages_per_visit: [{ pages_per_visit: 2 }], average_visit_duration: [{ average_visit_duration: 120 }], bounce_rate: [{ bounce_rate: 0.45 }] }));
    });
    vi.stubGlobal('fetch', fetch);
    expect(await scrapeSimilarWebDomain(apiConfig, 'example.com')).toEqual({ saved: true, hadData: true });
    expect(fetch).toHaveBeenCalledTimes(6); expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toBe('website-scraped');
  });
  it('does not save or bill rejected API keys', async () => {
    const { save } = mockApiRuntime();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(scrapeSimilarWebDomain(apiConfig, 'example.com')).rejects.toThrow(/401/);
    expect(save).not.toHaveBeenCalled();
  });
  it.each([403, 429, 500])('does not bill a fully unavailable HTTP %s response or add automatic retries', async (status) => {
    const { save } = mockApiRuntime();
    const fetch = vi.fn(async () => new Response('{}', { status })); vi.stubGlobal('fetch', fetch);
    expect(await scrapeSimilarWebDomain(apiConfig, 'example.com')).toEqual({ saved: false, hadData: false });
    expect(fetch).toHaveBeenCalledTimes(6); expect(save).not.toHaveBeenCalled();
  });
  it('does not print secret-bearing network exceptions', async () => {
    const { warning, save } = mockApiRuntime();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('https://private.invalid?api_key=SYNTHETIC_PRIVATE_KEY'); }));
    expect((await scrapeSimilarWebDomain(apiConfig, 'example.com')).hadData).toBe(false);
    expect(JSON.stringify(warning.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_KEY'); expect(save).not.toHaveBeenCalled();
  });
  it('does not save numbers accidentally parsed from an error string', async () => {
    const { save } = mockApiRuntime();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ visits: 'error 429', global_rank: 'error 403' }))));
    expect((await scrapeSimilarWebDomain(apiConfig, 'example.com')).hadData).toBe(false); expect(save).not.toHaveBeenCalled();
  });
  it('sanitizes dataset/billing failure and stops additional domains', async () => {
    const { save } = mockApiRuntime(); save.mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_KEY'));
    const fetch = vi.fn(async () => new Response(JSON.stringify({ visits: [{ visits: 100 }] }))); vi.stubGlobal('fetch', fetch);
    await expect(scrapeSimilarWebDomain(apiConfig, 'example.com')).rejects.toThrow(/billing failed/);
    expect(String(getSimilarWebRunState().fatalBillingError)).not.toContain('SYNTHETIC_PRIVATE_KEY');
    await expect(scrapeSimilarWebDomain(apiConfig, 'example.net')).rejects.toThrow(/billing failed/);
    expect(fetch).toHaveBeenCalledTimes(6); expect(save).toHaveBeenCalledTimes(1);
  });
});
