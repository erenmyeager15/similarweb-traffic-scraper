import { Actor, log } from 'apify';
import { getSimilarWebRunState, parseConfig, scrapeSimilarWebDomain } from './routes.js';
import type { ActorInput } from './types.js';

Actor.main(async () => {
  const input = (await Actor.getInput()) as ActorInput | null;

  // Fail fast BEFORE any network request or website-scraped billing when the
  // API key or domains are missing/invalid.
  const config = parseConfig(input);

  log.info(`Starting SimilarWeb official-API lookup for ${config.domains.length} domain(s): ${config.domains.join(', ')}`);
  log.info(`Country: ${config.country} | date range: ${config.startDate} to ${config.endDate}`);

  let domainsWithData = 0;
  let domainsWithoutData = 0;

  for (const domain of config.domains) {
    const state = getSimilarWebRunState();
    if (state.spendingLimitReached || state.fatalBillingError) break;

    const result = await scrapeSimilarWebDomain(config, domain);
    if (result.saved) domainsWithData += 1;
    else if (!result.hadData) domainsWithoutData += 1;
  }

  const runState = getSimilarWebRunState();
  if (runState.fatalBillingError) throw runState.fatalBillingError;

  if (runState.savedWebsiteCount === 0) {
    const message = [
      `No usable Similarweb API metrics were returned for ${domainsWithoutData} checked domain(s).`,
      'Nothing was charged for website-scraped events.',
      'Check the API key, subscription coverage, endpoint access, date range, country, and domain spelling.',
    ].join(' ');
    await Actor.setStatusMessage(message);
    throw new Error(message);
  }

  await Actor.setStatusMessage(`Saved ${runState.savedWebsiteCount} website record(s) from the official Similarweb API.`);
  log.info(`Finished. Saved ${runState.savedWebsiteCount} website record(s); ${domainsWithoutData} domain(s) returned no data.`);
});
