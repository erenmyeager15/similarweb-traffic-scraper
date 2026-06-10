import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { overviewHandler } from './routes.js';
import type { ActorInput, WebsiteRecord } from './types.js';

function normalizeDomain(input: string): string {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.replace(/^www\./, '');
  domain = domain.replace(/\/.*$/, '');
  return domain;
}

function validateDomains(domains: string[]): string[] {
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;
  const valid: string[] = [];
  const seen = new Set<string>();

  for (const raw of domains) {
    const normalized = normalizeDomain(raw);

    if (!normalized) {
      log.warning(`Skipping empty domain input: "${raw}"`);
      continue;
    }

    if (!domainRegex.test(normalized)) {
      log.warning(`Skipping invalid domain: "${raw}" → "${normalized}"`);
      continue;
    }

    if (seen.has(normalized)) {
      log.warning(`Skipping duplicate domain: "${normalized}"`);
      continue;
    }

    seen.add(normalized);
    valid.push(normalized);
  }

  return valid;
}

Actor.main(async () => {
  const input = (await Actor.getInput()) as ActorInput | null;

  if (!input || !input.domains || !Array.isArray(input.domains) || input.domains.length === 0) {
    throw new Error('Input is required. Please provide a list of domains in the "domains" field.');
  }

  const maxResults = input.maxResults ?? input.domains.length;
  const rawDomains = input.domains.slice(0, maxResults);
  const domains = validateDomains(rawDomains);

  if (domains.length === 0) {
    throw new Error('No valid domains found in input. Please provide valid domain names.');
  }

  log.info(`Starting SimilarWeb scraper for ${domains.length} domain(s): ${domains.join(', ')}`);

  const proxyConfiguration = input.proxyConfiguration
    ? await Actor.createProxyConfiguration({
        useApifyProxy: input.proxyConfiguration.useApifyProxy ?? true,
        apifyProxyGroups: input.proxyConfiguration.apifyProxyGroups ?? ['RESIDENTIAL'],
        apifyProxyCountry: input.proxyConfiguration.apifyProxyCountry,
      })
    : await Actor.createProxyConfiguration({
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
      });

  const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    sessionPoolOptions: {
      maxPoolSize: 10,
      sessionOptions: {
        maxUsageCount: 10,
      },
    },
    maxConcurrency: 2,
    maxRequestRetries: 3,
    retryOnBlocked: true,
    useSessionPool: true,
    requestHandlerTimeoutSecs: 120,
    preNavigationHooks: [
      async ({ page }) => {
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        });
      },
    ],
    requestHandler: overviewHandler,
    failedRequestHandler: async ({ request, log: ctxLog }) => {
      ctxLog.error(`Request failed after all retries: ${request.url} — not charging.`);
    },
  });

  const requests = domains.map((domain) => ({
    url: `https://data.similarweb.com/api/v1/data?domain=${domain}`,
    userData: { domain },
  }));

  await crawler.run(requests);

  log.info('SimilarWeb scraper finished successfully.');
});
