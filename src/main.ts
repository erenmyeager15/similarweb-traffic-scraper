import { Actor, log } from 'apify';
import { getSimilarWebRunState, parseConfig, scrapeSimilarWebDomain } from './routes.js';
import type { ActorInput } from './types.js';

Actor.main(async () => {
  const input = (await Actor.getInput()) as ActorInput | null;

  // Fail fast before any network request or website-scraped billing when the
  // domain input is missing or invalid.
  const config = parseConfig(input);
  const proxyConfiguration = input?.proxyConfiguration?.useApifyProxy
    ? await Actor.createProxyConfiguration({
        groups: input.proxyConfiguration.apifyProxyGroups,
        countryCode: input.proxyConfiguration.apifyProxyCountry,
      })
    : undefined;

  log.info(`Starting SimilarWeb ${config.mode} lookup for ${config.domains.length} domain(s): ${config.domains.join(', ')}`);
  if (config.mode === 'official-api') {
    log.info(`Country: ${config.country} | date range: ${config.startDate} to ${config.endDate}`);
  }

  let domainsWithData = 0;
  let domainsWithoutData = 0;

  for (const domain of config.domains) {
    const state = getSimilarWebRunState();
    if (state.spendingLimitReached || state.fatalBillingError) break;

    const result = await scrapeSimilarWebDomain(config, domain, proxyConfiguration);
    if (result.saved) domainsWithData += 1;
    else if (!result.hadData) domainsWithoutData += 1;
  }

  const runState = getSimilarWebRunState();
  if (runState.fatalBillingError) throw runState.fatalBillingError;

  if (runState.savedWebsiteCount === 0) {
    const message = [
      `No usable Similarweb metrics were returned for ${domainsWithoutData} checked domain(s).`,
      'Nothing was charged for website-scraped events.',
      config.mode === 'official-api'
        ? 'Check the API key, subscription coverage, endpoint access, date range, country, and domain spelling.'
        : 'The public endpoint may be unavailable or regionally blocked. Try the Residential proxy setting, another established domain, or provide an official Similarweb API key.',
    ].join(' ');
    await Actor.setStatusMessage(message);
    throw new Error(message);
  }

  await Actor.setStatusMessage(`Saved ${runState.savedWebsiteCount} website record(s) using ${config.mode}.`);
  log.info(`Finished. Saved ${runState.savedWebsiteCount} website record(s); ${domainsWithoutData} domain(s) returned no data.`);
});
