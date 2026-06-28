import { Actor, log } from 'apify';
import { getSimilarWebRunState, scrapeSimilarWebDomain } from './routes.js';
import type { ActorInput } from './types.js';

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
      log.warning(`Skipping invalid domain: "${raw}" -> "${normalized}"`);
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

  let failedDomainCount = 0;

  for (const domain of domains) {
    const saved = await scrapeSimilarWebDomain(domain, proxyConfiguration);
    if (!saved) failedDomainCount += 1;
  }

  const runState = getSimilarWebRunState();
  if (runState.fatalBillingError) throw runState.fatalBillingError;
  if (runState.savedWebsiteCount === 0 && failedDomainCount > 0) {
    await Actor.setStatusMessage(`Finished with no saved websites. SimilarWeb returned no usable data for ${failedDomainCount} domain(s).`);
    log.warning(`SimilarWeb returned no usable data for ${failedDomainCount} domain(s). Finishing without charging website-scraped events.`);
    return;
  }
  if (runState.savedWebsiteCount === 0 && !runState.spendingLimitReached) {
    await Actor.setStatusMessage('Finished with no saved websites.');
    log.warning('SimilarWeb scrape finished with no saved websites.');
    return;
  }

  log.info(`SimilarWeb scraper finished successfully with ${runState.savedWebsiteCount} saved website records.`);
});
