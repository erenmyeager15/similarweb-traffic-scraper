import { Actor, log } from 'apify';
import { getSimilarWebRunState, parseConfig, scrapeSimilarWebDomain } from './routes.js';
import type { ActorInput } from './types.js';
import { ImportInputError, selectMode } from './importer.js';
import { runImportWorkflow } from './import-workflow.js';
import { WEBSITE_SCRAPED_EVENT } from './routes.js';
import { runDemoWorkflow } from './demo-workflow.js';

Actor.main(async () => {
  const input = (await Actor.getInput()) as ActorInput | null;
  const mode = selectMode(input);

  if (mode === 'demo') {
    await runDemoWorkflow(input, {
      write: async (key, value, contentType) => {
        await Actor.setValue(key, value, contentType ? { contentType } : undefined);
      },
      status: async (message) => { await Actor.setStatusMessage(message); },
    });
    return;
  }

  if (mode === 'import') {
    try {
      await runImportWorkflow(input, {
        canSave: () => Actor.getChargingManager().calculateMaxEventChargeCountWithinLimit(WEBSITE_SCRAPED_EVENT) > 0,
        save: (record) => Actor.pushData(record, WEBSITE_SCRAPED_EVENT),
        write: async (key, value, contentType) => {
          await Actor.setValue(key, value, contentType ? { contentType } : undefined);
        },
        status: async (message) => { await Actor.setStatusMessage(message); },
      });
    } catch (error) {
      if (error instanceof ImportInputError) {
        await Actor.setValue('RUN_STATUS', { mode: 'import', outcome: 'invalid_input', code: error.code, message: error.message, savedDomainCount: 0, upstreamRequestCount: 0 });
        await Actor.setStatusMessage(error.message);
      }
      throw error;
    }
    return;
  }

  // Fail fast BEFORE any network request or website-scraped billing when the
  // API key or domains are missing/invalid.
  const config = parseConfig(input);

  log.info(`Starting SimilarWeb official-API lookup for ${config.domains.length} domain(s): ${config.domains.join(', ')}`);
  log.info(`Country: ${config.country} | date range: ${config.startDate} to ${config.endDate}`);

  let domainsWithoutData = 0;

  for (const domain of config.domains) {
    const state = getSimilarWebRunState();
    if (state.spendingLimitReached || state.fatalBillingError) break;

    const result = await scrapeSimilarWebDomain(config, domain);
    if (!result.hadData) domainsWithoutData += 1;
  }

  const runState = getSimilarWebRunState();
  if (runState.fatalBillingError) throw runState.fatalBillingError;

  if (runState.savedWebsiteCount === 0) {
    if (runState.spendingLimitReached) {
      await Actor.setStatusMessage('Stopped at the spending limit: no website result saved or result-charged. No further API requests were made. Actor Start may still apply.');
      return;
    }
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
