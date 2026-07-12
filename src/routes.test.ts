import { describe, expect, it } from 'vitest';
import {
  buildWebsiteRecord,
  defaultMonthRange,
  extractLatestNumber,
  hasRealMetric,
  interpretChargeResult,
  parseConfig,
} from './routes.js';

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
