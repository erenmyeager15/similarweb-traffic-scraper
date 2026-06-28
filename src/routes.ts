import type { PlaywrightCrawlingContext } from 'crawlee';
import { Actor } from 'apify';
import { gotScraping } from 'got-scraping';
import type { WebsiteRecord, CountryTraffic } from './types.js';

let savedWebsiteCount = 0;
let spendingLimitReached = false;
let fatalBillingError: Error | null = null;

interface ProxyLike {
  newUrl: () => string | undefined | Promise<string | undefined>;
}

export function getSimilarWebRunState(): {
  savedWebsiteCount: number;
  spendingLimitReached: boolean;
  fatalBillingError: Error | null;
} {
  return {
    savedWebsiteCount,
    spendingLimitReached,
    fatalBillingError,
  };
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  const n = match ? Number(match[0]) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pct(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : Math.round(n * 1000) / 10;
}

function pctMaybe(value: unknown): number | null {
  const n = num(value);
  if (n === null) return null;
  return n <= 1 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10;
}

function parseCompactNumber(value: string, suffix?: string): string | null {
  const n = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;

  const multiplier = suffix?.toUpperCase() === 'B' ? 1_000_000_000
    : suffix?.toUpperCase() === 'M' ? 1_000_000
      : suffix?.toUpperCase() === 'K' ? 1_000
        : 1;

  return String(Math.round(n * multiplier));
}

function parseCompactCount(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value)) : null;

  const match = String(value).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  return match ? parseCompactNumber(match[1], match[2]) : null;
}

function parseDurationSeconds(value: string): number | null {
  const parts = value.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function parseDurationValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const timeMatch = value.match(/\d{1,2}:\d{2}(?::\d{2})?/);
  return timeMatch ? parseDurationSeconds(timeMatch[0]) : num(value);
}

function parseRank(text: string, label: string): number | null {
  const match = text.match(new RegExp(`${label}[\\s\\S]{0,120}?#\\s*([\\d,]+)`, 'i'));
  return match ? num(match[1].replace(/,/g, '')) : null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function htmlToSearchableText(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getPath(data: unknown, path: string[]): unknown {
  let cursor = data as any;
  for (const part of path) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function pickPath(data: unknown, paths: string[][]): unknown {
  for (const path of paths) {
    const value = getPath(data, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function deepFindValue(data: unknown, wantedKeys: string[], depth = 0): unknown {
  if (!data || typeof data !== 'object' || depth > 8) return undefined;

  const wanted = new Set(wantedKeys.map(normalizeKey));
  if (Array.isArray(data)) {
    for (const item of data) {
      const value = deepFindValue(item, wantedKeys, depth + 1);
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  }

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (wanted.has(normalizeKey(key)) && value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  for (const value of Object.values(data as Record<string, unknown>)) {
    const found = deepFindValue(value, wantedKeys, depth + 1);
    if (found !== undefined && found !== null && found !== '') return found;
  }

  return undefined;
}

function rankValue(value: unknown): number | null {
  if (value && typeof value === 'object') {
    return num((value as Record<string, unknown>).Rank ?? (value as Record<string, unknown>).rank ?? (value as Record<string, unknown>).Value ?? (value as Record<string, unknown>).value);
  }
  return num(value);
}

function parseWebsitePageText(domain: string, text: string): WebsiteRecord | null {
  const normalizedText = text.replace(/\r/g, '');
  const globalRank = parseRank(normalizedText, 'Global Rank');
  const countryRank = parseRank(normalizedText, 'Country Rank');
  const categoryRank = parseRank(normalizedText, 'Category Rank');

  const escapedDomain = domain.replace(/\./g, '\\.');
  const visitsMatch = normalizedText.match(/Total Visits(?:\s+Last\s+\d+\s+Months?)?[\s\S]{0,240}?([\d.]+)\s*([KMB])/i)
    ?? normalizedText.match(new RegExp(`([\\d.]+)\\s*([KMB])(?:\\s|[\\s\\S]{0,80})${escapedDomain}`, 'i'));
  const monthlyVisits = visitsMatch ? parseCompactNumber(visitsMatch[1], visitsMatch[2]) : null;

  const visitDurationMatch = normalizedText.match(/Avg Visit Duration[\s\S]{0,120}?(\d{1,2}:\d{2}(?::\d{2})?)/i);
  const pagesPerVisitMatch = normalizedText.match(/Pages per Visit[\s\S]{0,120}?([\d.]+)/i);
  const bounceRateMatch = normalizedText.match(/Bounce Rate[\s\S]{0,120}?([\d.]+)%/i);
  const categoryNameMatch = normalizedText.match(/Category Rank[\s\S]{0,180}?#\s*[\d,]+[\s\S]{0,160}?\n\s*([^\n]+?)\s*\(In/i)
    ?? normalizedText.match(/Category Rank[\s\S]{0,220}?\(In\s+([^)]+)\)/i);

  if (globalRank === null && categoryRank === null && monthlyVisits === null) return null;

  return {
    domain,
    globalRank,
    countryRank,
    categoryRank,
    categoryName: categoryNameMatch?.[1]?.trim() || null,
    monthlyVisits,
    visitDuration: visitDurationMatch ? parseDurationSeconds(visitDurationMatch[1]) : null,
    pagesPerVisit: pagesPerVisitMatch ? num(pagesPerVisitMatch[1]) : null,
    bounceRate: bounceRateMatch ? num(bounceRateMatch[1]) : null,
    trafficChangeMoM: null,
    topCountries: [],
    trafficSources: {
      direct: null,
      search: null,
      social: null,
      referral: null,
      email: null,
      displayAds: null,
    },
    topReferringDomains: [],
    topSearchKeywords: [],
    topSocialNetworks: [],
    technologies: [],
    similarWebUrl: `https://www.similarweb.com/website/${domain}/`,
    scrapedAt: new Date().toISOString(),
  };
}

function buildRecordFromJson(domain: string, data: any): WebsiteRecord | null {
  if (!data || (!data.GlobalRank && !data.Engagments && !data.Category)) return null;

  const eng = data.Engagments ?? {};
  const ts = data.TrafficSources ?? {};

  const topCountries: CountryTraffic[] = Array.isArray(data.TopCountryShares)
    ? data.TopCountryShares.slice(0, 5).map((c: { Country?: number; CountryCode?: string; Value?: number }) => ({
        country: String(c.CountryCode ?? c.Country ?? ''),
        trafficPercentage: pct(c.Value) ?? 0,
      }))
    : [];

  const visits = num(eng.Visits);

  return {
    domain,
    globalRank: data.GlobalRank?.Rank ?? null,
    countryRank: data.CountryRank?.Rank ?? null,
    categoryRank: data.CategoryRank?.Rank ?? null,
    categoryName: data.Category ?? null,
    monthlyVisits: visits !== null ? String(Math.round(visits)) : null,
    visitDuration: num(eng.TimeOnSite),
    pagesPerVisit: num(eng.PagePerVisit),
    bounceRate: pct(eng.BounceRate),
    trafficChangeMoM: null,
    topCountries,
    trafficSources: {
      direct: pct(ts.Direct),
      search: pct(ts.Search),
      social: pct(ts.Social),
      referral: pct(ts.Referrals),
      email: pct(ts.Mail),
      displayAds: pct(ts['Paid Referrals']),
    },
    topReferringDomains: [],
    topSearchKeywords: [],
    topSocialNetworks: [],
    technologies: [],
    similarWebUrl: `https://www.similarweb.com/website/${domain}/`,
    scrapedAt: new Date().toISOString(),
  };
}

function buildRecordFromFlexibleJson(domain: string, data: any): WebsiteRecord | null {
  const globalRank = rankValue(
    pickPath(data, [['GlobalRank'], ['globalRank'], ['global_rank']])
      ?? deepFindValue(data, ['globalRank', 'global_rank']),
  );
  const countryRank = rankValue(
    pickPath(data, [['CountryRank'], ['countryRank'], ['country_rank']])
      ?? deepFindValue(data, ['countryRank', 'country_rank']),
  );
  const categoryRank = rankValue(
    pickPath(data, [['CategoryRank'], ['categoryRank'], ['category_rank']])
      ?? deepFindValue(data, ['categoryRank', 'category_rank']),
  );

  const monthlyVisits = parseCompactCount(
    pickPath(data, [
      ['Engagments', 'Visits'],
      ['Engagements', 'Visits'],
      ['EstimatedMonthlyVisits'],
      ['estimatedMonthlyVisits'],
      ['visitsTotalCount'],
      ['totalVisits'],
      ['monthlyVisits'],
    ])
      ?? deepFindValue(data, ['visitsTotalCount', 'estimatedMonthlyVisits', 'monthlyVisits', 'totalVisits', 'visits']),
  );

  const visitDuration = parseDurationValue(
    pickPath(data, [
      ['Engagments', 'TimeOnSite'],
      ['Engagements', 'TimeOnSite'],
      ['averageVisitDuration'],
      ['avgVisitDuration'],
      ['visitDuration'],
    ])
      ?? deepFindValue(data, ['timeOnSite', 'averageVisitDuration', 'avgVisitDuration', 'visitDuration']),
  );

  const pagesPerVisit = num(
    pickPath(data, [
      ['Engagments', 'PagePerVisit'],
      ['Engagements', 'PagePerVisit'],
      ['pagesPerVisit'],
    ])
      ?? deepFindValue(data, ['pagePerVisit', 'pagesPerVisit']),
  );

  const bounceRate = pctMaybe(
    pickPath(data, [
      ['Engagments', 'BounceRate'],
      ['Engagements', 'BounceRate'],
      ['bounceRate'],
    ])
      ?? deepFindValue(data, ['bounceRate']),
  );

  if (globalRank === null && categoryRank === null && monthlyVisits === null) return null;

  return {
    domain,
    globalRank,
    countryRank,
    categoryRank,
    categoryName: String(
      pickPath(data, [['Category'], ['category'], ['categoryName']])
        ?? deepFindValue(data, ['category', 'categoryName'])
        ?? '',
    ).trim() || null,
    monthlyVisits,
    visitDuration,
    pagesPerVisit,
    bounceRate,
    trafficChangeMoM: null,
    topCountries: [],
    trafficSources: {
      direct: pctMaybe(pickPath(data, [['TrafficSources', 'Direct']]) ?? deepFindValue(data, ['direct'])),
      search: pctMaybe(pickPath(data, [['TrafficSources', 'Search']]) ?? deepFindValue(data, ['search'])),
      social: pctMaybe(pickPath(data, [['TrafficSources', 'Social']]) ?? deepFindValue(data, ['social'])),
      referral: pctMaybe(pickPath(data, [['TrafficSources', 'Referrals']]) ?? deepFindValue(data, ['referrals', 'referral'])),
      email: pctMaybe(pickPath(data, [['TrafficSources', 'Mail']]) ?? deepFindValue(data, ['mail', 'email'])),
      displayAds: pctMaybe(pickPath(data, [['TrafficSources', 'Paid Referrals']]) ?? deepFindValue(data, ['paidReferrals', 'displayAds'])),
    },
    topReferringDomains: [],
    topSearchKeywords: [],
    topSocialNetworks: [],
    technologies: [],
    similarWebUrl: `https://www.similarweb.com/website/${domain}/`,
    scrapedAt: new Date().toISOString(),
  };
}

async function saveWebsiteRecord(record: WebsiteRecord, ctxLog: Pick<Console, 'info' | 'error'>): Promise<boolean> {
  try {
    const chargeResult = await Actor.pushData(record, 'website-scraped');
    const recordWasSaved = chargeResult.chargedCount > 0 || !chargeResult.eventChargeLimitReached;

    if (recordWasSaved) savedWebsiteCount += 1;

    if (chargeResult.eventChargeLimitReached) {
      spendingLimitReached = true;
      await Actor.setStatusMessage(`Stopped at the user's spending limit after ${savedWebsiteCount} websites`);
      ctxLog.info('User spending limit reached; stopping before more SimilarWeb records are saved.');
    }

    return recordWasSaved;
  } catch (error) {
    fatalBillingError = error instanceof Error ? error : new Error(String(error));
    spendingLimitReached = true;
    await Actor.setStatusMessage('Stopped because website output billing failed.');
    ctxLog.error(`Stopping SimilarWeb run because dataset push with website-scraped charge failed: ${fatalBillingError.message}`);
    throw fatalBillingError;
  }
}

export async function scrapeSimilarWebDomain(domain: string, proxyConfiguration?: ProxyLike): Promise<boolean> {
  if (fatalBillingError) throw fatalBillingError;
  if (spendingLimitReached) return false;

  const proxyUrl = await proxyConfiguration?.newUrl();
  const endpointRequests = [
    {
      label: 'extension-data',
      url: `https://data.similarweb.com/api/v1/data?domain=${domain}`,
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        origin: 'chrome-extension://hoklmmgfnpapgjgcpechhaamimifchmp',
        referer: 'https://www.similarweb.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
    },
    {
      label: 'overview-header',
      url: `https://www.similarweb.com/api/WebsiteOverview/getheader?domain=${domain}`,
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        referer: `https://www.similarweb.com/website/${domain}/`,
        'x-requested-with': 'XMLHttpRequest',
      },
    },
    {
      label: 'overview-data',
      url: `https://www.similarweb.com/api/WebsiteOverview/getOverviewData?domain=${domain}`,
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        referer: `https://www.similarweb.com/website/${domain}/`,
        'x-requested-with': 'XMLHttpRequest',
      },
    },
  ];

  for (const endpoint of endpointRequests) {
    const response = await gotScraping({
      url: endpoint.url,
      proxyUrl,
      throwHttpErrors: false,
      timeout: { request: 30_000 },
      headers: endpoint.headers,
    });

    const body = String(response.body ?? '');
    if (response.statusCode !== 200) {
      console.warn(`SimilarWeb ${endpoint.label} returned ${response.statusCode} for ${domain}. Body sample: ${body.slice(0, 200)}`);
      continue;
    }

    let data: any;
    try {
      data = JSON.parse(body);
    } catch {
      console.warn(`SimilarWeb ${endpoint.label} returned non-JSON for ${domain}. Body sample: ${body.slice(0, 200)}`);
      continue;
    }

    const record = buildRecordFromJson(domain, data) ?? buildRecordFromFlexibleJson(domain, data);
    if (!record) {
      console.warn(`SimilarWeb ${endpoint.label} returned no usable metrics for ${domain}.`);
      continue;
    }

    const saved = await saveWebsiteRecord(record, console);
    console.info(`Scraped ${domain} via ${endpoint.label}: globalRank=${record.globalRank}, visits=${record.monthlyVisits}`);
    return saved;
  }

  const pageUrl = `https://www.similarweb.com/website/${domain}/`;
  const pageResponse = await gotScraping({
    url: pageUrl,
    proxyUrl,
    throwHttpErrors: false,
    timeout: { request: 30_000 },
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      pragma: 'no-cache',
      'upgrade-insecure-requests': '1',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    },
  });

  const pageBody = String(pageResponse.body ?? '');
  if (pageResponse.statusCode !== 200) {
    console.warn(`SimilarWeb public page returned ${pageResponse.statusCode} for ${domain}. Body sample: ${pageBody.slice(0, 200)}`);
  } else {
    const pageText = htmlToSearchableText(pageBody);
    const pageRecord = parseWebsitePageText(domain, pageText);
    if (pageRecord) {
      const saved = await saveWebsiteRecord(pageRecord, console);
      console.info(`Scraped ${domain} via public-page fallback: globalRank=${pageRecord.globalRank}, visits=${pageRecord.monthlyVisits}`);
      return saved;
    }

    console.warn(`SimilarWeb public page returned no usable metrics for ${domain}. Text sample: ${pageText.slice(0, 300)}`);
  }

  const readerUrls = [
    `https://r.jina.ai/http://https://www.similarweb.com/website/${domain}/`,
    `https://r.jina.ai/http://www.similarweb.com/website/${domain}/`,
  ];

  for (const readerUrl of readerUrls) {
    const readerResponse = await gotScraping({
      url: readerUrl,
      throwHttpErrors: false,
      timeout: { request: 45_000 },
      headers: {
        accept: 'text/plain, text/markdown, */*',
        'accept-language': 'en-US,en;q=0.9',
      },
    });

    const readerText = String(readerResponse.body ?? '');
    if (readerResponse.statusCode !== 200) {
      console.warn(`SimilarWeb reader fallback returned ${readerResponse.statusCode} for ${domain}. Body sample: ${readerText.slice(0, 200)}`);
      continue;
    }

    const readerRecord = parseWebsitePageText(domain, readerText);
    if (!readerRecord) {
      console.warn(`SimilarWeb reader fallback returned no usable metrics for ${domain}. Text sample: ${readerText.slice(0, 300)}`);
      continue;
    }

    const saved = await saveWebsiteRecord(readerRecord, console);
    console.info(`Scraped ${domain} via reader fallback: globalRank=${readerRecord.globalRank}, visits=${readerRecord.monthlyVisits}`);
    return saved;
  }

  return false;
}

export function parseSimilarWebPageForTest(domain: string, htmlOrText: string): WebsiteRecord | null {
  const input = /<[^>]+>/.test(htmlOrText) ? htmlToSearchableText(htmlOrText) : htmlOrText;
  return parseWebsitePageText(domain, input);
}

export function htmlToSearchableTextForTest(html: string): string {
  return htmlToSearchableText(html);
}

/**
 * SimilarWeb can expose metrics as JSON in some contexts and as visible text on
 * the public website page in others. The handler supports both shapes so the
 * default QA sample can still return a clean dataset item when the JSON endpoint
 * is temporarily blocked.
 */
export async function overviewHandler(context: PlaywrightCrawlingContext): Promise<void> {
  const { page, request, log: ctxLog } = context;
  const domain = (request.userData as { domain: string }).domain;

  if (fatalBillingError) throw fatalBillingError;
  if (spendingLimitReached) {
    ctxLog.info(`Skipping ${domain} because the user's spending limit was already reached.`);
    return;
  }

  ctxLog.info(`Scraping SimilarWeb data for: ${domain}`);

  await page.waitForFunction(
    () => /Global Rank|Total Visits|Monthly Visits|Category Rank/i.test(document.body.innerText),
    { timeout: 20_000 },
  ).catch(() => undefined);

  const pageText = await page.evaluate(() => document.body.innerText);
  const data = await page.evaluate(() => {
    try {
      return JSON.parse(document.body.innerText);
    } catch {
      return null;
    }
  });

  let record: WebsiteRecord | null = null;

  if (!data || (!data.GlobalRank && !data.Engagments && !data.Category)) {
    record = parseWebsitePageText(domain, pageText);
  }

  if (!data && !record) {
    const sample = pageText.replace(/\s+/g, ' ').trim().slice(0, 300);
    ctxLog.warning(`No data for ${domain} (blocked or not found). Not saving or charging. Page text sample: ${sample}`);
    return;
  }

  if (!record) {
    record = buildRecordFromJson(domain, data);
    if (!record) return;
  }

  await saveWebsiteRecord(record, ctxLog);

  ctxLog.info(`Scraped ${domain}: globalRank=${record.globalRank}, visits=${record.monthlyVisits}`);
}
