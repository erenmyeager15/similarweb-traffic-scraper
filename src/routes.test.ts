import { describe, expect, it } from 'vitest';
import {
  buildPublicWebsiteRecord,
  buildWebsiteRecord,
  defaultMonthRange,
  extractLatestNumber,
  hasRealMetric,
  interpretChargeResult,
  parseConfig,
} from './routes.js';

describe('parseConfig (fail fast before network/billing)', () => {
  it('uses public-data mode when the API key is missing', () => {
    const cfg = parseConfig({ domains: ['openai.com'] });
    expect(cfg.mode).toBe('public-data');
    expect(cfg.apiKey).toBeNull();
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
    expect(cfg.mode).toBe('official-api');
    expect(cfg.domains).toEqual(['openai.com']);
    expect(cfg.country).toBe('us');
    expect(cfg.startDate).toMatch(/^\d{4}-\d{2}$/);
    expect(cfg.endDate).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('buildPublicWebsiteRecord (maps public summary data)', () => {
  it('maps ranks, engagement, category, and traffic shares', () => {
    const record = buildPublicWebsiteRecord('github.com', {
      Engagments: {
        BounceRate: 0.4461,
        Month: 5,
        Year: 2026,
        PagePerVisit: 5.27,
        Visits: 498123456,
        TimeOnSite: 412.4,
      },
      GlobalRank: { Rank: 71 },
      CountryRank: { CountryCode: 'US', Rank: 86 },
      CategoryRank: { Category: 'Computers_Electronics_and_Technology', Rank: 2 },
      TrafficSources: {
        Direct: 0.512,
        SearchOrganic: 0.331,
        SearchPaid: 0.004,
        SocialOrganic: 0.081,
        SocialPaid: 0.002,
        Referrals: 0.056,
        Mail: 0.008,
        DisplayAds: 0.003,
        GenAi: 0.002,
        Affiliate: 0.001,
      },
    });

    expect(record).toMatchObject({
      domain: 'github.com',
      country: 'us',
      startDate: '2026-05',
      endDate: '2026-05',
      globalRank: 71,
      countryRank: 86,
      categoryRank: 2,
      category: 'Computers_Electronics_and_Technology',
      monthlyVisits: 498123456,
      pagesPerVisit: 5.27,
      avgVisitDuration: 412.4,
      bounceRate: 44.6,
      source: 'similarweb-public-data',
      trafficSources: {
        direct: 51.2,
        organicSearch: 33.1,
        paidSearch: 0.4,
        organicSocial: 8.1,
        paidSocial: 0.2,
        referrals: 5.6,
        email: 0.8,
        displayAds: 0.3,
        genAi: 0.2,
        affiliate: 0.1,
      },
    });
    expect(hasRealMetric(record)).toBe(true);
  });

  it('does not create a real metric from an empty or error response', () => {
    const record = buildPublicWebsiteRecord('missing.example', { message: 'Forbidden' });
    expect(hasRealMetric(record)).toBe(false);
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
      countryRank: null,
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
