import { PlaywrightCrawlingContext } from 'crawlee';
import { Actor } from 'apify';
import type { WebsiteRecord, CountryTraffic } from './types.js';

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function pct(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : Math.round(n * 1000) / 10;
}

/**
 * SimilarWeb exposes a public JSON data endpoint (used by its browser extension)
 * at data.similarweb.com/api/v1/data?domain=... which returns rank, engagement,
 * traffic sources, and top countries without login. Far more reliable than
 * scraping the Cloudflare-gated, login-walled website DOM.
 */
export async function overviewHandler(context: PlaywrightCrawlingContext): Promise<void> {
  const { page, request, log: ctxLog } = context;
  const domain = (request.userData as { domain: string }).domain;

  ctxLog.info(`Scraping SimilarWeb data for: ${domain}`);

  const data = await page.evaluate(() => {
    try {
      return JSON.parse(document.body.innerText);
    } catch {
      return null;
    }
  });

  if (!data || (!data.GlobalRank && !data.Engagments && !data.Category)) {
    ctxLog.warning(`No data for ${domain} (blocked or not found). Not saving or charging.`);
    return;
  }

  const eng = data.Engagments ?? {};
  const ts = data.TrafficSources ?? {};

  const topCountries: CountryTraffic[] = Array.isArray(data.TopCountryShares)
    ? data.TopCountryShares.slice(0, 5).map((c: { Country?: number; CountryCode?: string; Value?: number }) => ({
        country: String(c.CountryCode ?? c.Country ?? ''),
        trafficPercentage: pct(c.Value) ?? 0,
      }))
    : [];

  const visits = num(eng.Visits);

  const record: WebsiteRecord = {
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

  await Actor.pushData(record);

  try {
    await Actor.charge({ eventName: 'website-scraped' });
  } catch (chargeError) {
    ctxLog.error(`PPE charge failed for ${domain}: ${chargeError}`);
  }

  ctxLog.info(`Scraped ${domain}: globalRank=${record.globalRank}, visits=${record.monthlyVisits}`);
}
