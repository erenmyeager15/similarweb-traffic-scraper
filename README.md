# SimilarWeb Traffic Analytics & US Agency Reports

Analyze **authorized website traffic CSV/JSON exports without a Similarweb API key**. Compare supplied monthly observations, competitor traffic, ranks and engagement, then export JSON, formula-safe CSV and Markdown reports for agency or in-house research. The optional official Similarweb API workflow remains available for customers who have their own API key and access.

Built for US SEO agencies, growth teams and competitor-research workflows that already have authorized exports. Convert those exports into auditable client reporting: explain which observations actually cover the United States, where periods or comparison context are missing, and which supplied changes cross your review thresholds. Worldwide data is never relabeled as US traffic.

> Import is not live collection. It does not open Similarweb pages, look up a domain's traffic automatically, consume Similarweb API credits or independently verify supplied figures. Provide data you own or have permission to process. The Actor does not grant data-sharing or redistribution rights.

## Choose Your Workflow

| Workflow | What you supply | What it does |
| --- | --- | --- |
| `demo` | No user data or key | Preview explicitly synthetic reports, with zero dataset results or website-result events; Actor Start and applicable usage may apply |
| `import` | Authorized CSV text or JSON observations and a provider label | Validate, deduplicate and analyze supplied data; no API key or proxy |
| `official-api` (experimental) | Your Similarweb API key, domain list and API access | Optional legacy lookup; live key/plan access and profitability remain unverified |

Existing API tasks that omit `mode` and supply an API key retain the API route. Import data takes priority when `mode` is omitted, so an unused key does not create a paid API fallback. Explicit API mode cannot also contain import data.

## Agency Reporting Features

- **Evidence-linked change alerts:** configurable visit rise/drop, bounce increase and global-rank worsening thresholds. Each finding includes the exact supplied previous/current values, dates, scope, rule and units. They are review signals, not predictions or reasons why traffic changed.
- **US vs worldwide scope audit:** distinguish matching, different and unknown country scope without filtering, rewriting or claiming verified audience geography. Other country focuses are supported too.
- **Comparison-quality checklist:** expose missing metrics/context, period gaps, latest supplied month per scope and whether matching visit peers exist. Complete fields do not establish accuracy, permission or market coverage.
- **Matched competitor comparisons:** only like-for-like supplied month, provider, country, device and estimated/measured basis. Included-domain shares never become claimed industry market shares.
- **Client-ready JSON/CSV/Markdown evidence:** separate comparison, alerts and quality files. Only confirmed saved domains appear; discarded secret columns stay out; formula-like labels are neutralized in CSV.

These features analyze supplied exports. No fresh traffic retrieval, channel/keyword discovery, persistent history, scheduled refresh or Slack/email notification is included. A scraper that retrieves new source data serves a different need; this Actor does not claim universal superiority or exclusive features across the marketplace.

## Preview the Report Format First

The new-user starter selects an explicit demo:

```json
{ "mode": "demo" }
```

It writes `DEMO_REPORT`, `DEMO_COMPARISON.csv` and `DEMO_REPORT.md` using fixed, developer-authored synthetic values on reserved example domains. Every preview is labeled **synthetic**, not live Similarweb data. It saves **zero dataset results** and triggers **zero `website-scraped` events**. Actor Start and applicable platform usage can still apply, so this is not a promise of a free run.

### Three US Agency Examples

| Demo preset | Preview |
| --- | --- |
| `us-agency-comparison` | Two reserved example domains, supplied monthly changes and a matched competitor comparison |
| `us-traffic-change-alerts` | Invented -30% visits, +7 bounce percentage points and +30% numerical rank worsening, with exact evidence |
| `us-scope-audit` | Why worldwide/unknown scope and non-adjacent months must not produce US monthly alerts |

```json
{
  "mode": "demo",
  "demoPreset": "us-traffic-change-alerts",
  "reportFocusCountry": "us",
  "visitChangeAlertPercent": 20,
  "bounceIncreaseAlertPoints": 5,
  "rankWorseningAlertPercent": 20
}
```

Demo also writes `DEMO_AGENCY_REPORT`, `DEMO_ALERTS.csv` and `DEMO_QUALITY.csv`. All rows remain explicitly synthetic and none are saved to the dataset or result-billed. The invented example months are not current measurements. The three input files are in `examples/`; do not run these previews repeatedly for user/run metrics.

The demo is only an onboarding preview—not live data collection, proof of repaired source access or customer reliability. It does not process imported data or credentials; select `import` or `official-api` explicitly for those. Empty or invalid import input is never converted into a successful demo. No automatic mode default is injected into existing API integrations. Nothing schedules or repeatedly runs the demo.

## Quick Start: No-Key Import

1. Export data you are authorized to process and identify its provider in `importSource`.
2. Paste JSON observations in `importRecords` OR CSV contents in `importCsv`, not both. File URLs and workbooks are not fetched or opened.
3. Confirm `authorizedData: true` only when you have the necessary rights.
4. Set `maxResults` to the number of whole website analyses to save. It defaults to **one domain, not one month**.
5. Open the dataset plus JSON, comparison CSV and Markdown report links.

This is **synthetic example data**, not measured Similarweb output. Replace it with your permitted export. Each saved analyzed domain is billable even when you intentionally provide illustrative values; user-provided data is not authenticated by this Actor.

```json
{
  "mode": "import",
  "authorizedData": true,
  "importSource": "Synthetic example - replace with your provider",
  "maxResults": 2,
  "importRecords": [
    { "domain": "example.com", "month": "2026-08", "country": "us", "trafficType": "all-traffic", "measurementType": "estimated", "monthlyVisits": 1000 },
    { "domain": "example.com", "month": "2026-09", "country": "us", "trafficType": "all-traffic", "measurementType": "estimated", "monthlyVisits": 1200 },
    { "domain": "example.net", "month": "2026-09", "country": "us", "trafficType": "all-traffic", "measurementType": "estimated", "monthlyVisits": 1800 }
  ]
}
```

For CSV, use the following columns in `importCsv` instead of `importRecords`. These values are synthetic examples too.

```csv
domain,month,country,trafficType,measurementType,monthlyVisits,bounceRate,avgVisitDuration
example.com,2026-08,us,all-traffic,estimated,1000,54.9%,00:02:30
example.com,2026-09,us,all-traffic,estimated,1200,50.0%,00:02:45
```

No real-input metrics or automatic rights confirmation are preloaded. The starter is an explicit, non-result-billed synthetic demo. Real import mode requires the user's permitted export and explicit rights confirmation. Empty import input is rejected, not shown as successful live retrieval.

## Imported Data Contract

| Field | Rules |
| --- | --- |
| `domain` | Required public domain or HTTP(S) URL; normalized, never visited |
| `month` | Required `YYYY-MM`, or a real date in that month; no multi-month totals or guessed dates |
| `country` | `world` or a two-letter scope; missing stays unknown, never assumed US/world |
| `trafficType` | `all-traffic`, `desktop` or `mobile-web`; missing disables comparisons |
| `measurementType` | `estimated` or `measured`; missing disables comparisons |
| `monthlyVisits` | Nonnegative integer; monthly visits only, not unique visitors or three-month totals |
| `globalRank`, `categoryRank` | Positive integer or unknown; category-rank changes require the same known category |
| `category` | Optional short category label |
| `pagesPerVisit` | Nonnegative number or unknown |
| `avgVisitDuration` | Seconds, `MM:SS` or `HH:MM:SS` |
| `bounceRate` | Percent from 0 to 100: `0.5` means 0.5%, not 50% |
| `bounceRateFraction` | Explicit fraction from 0 to 1; do not also supply `bounceRate` |

At least one numeric traffic, engagement or rank metric is required per observation. Empty/`N/A`/`null`/unknown metric cells stay `null`; zero is preserved. Raw numbers and correctly grouped thousands are supported. Formulas and abbreviated K/M/B numbers are rejected rather than misinterpreted.

CSV supports quoted commas, escaped quotes, CRLF and UTF-8 BOM. Common headers such as Website, Date, Global Rank, Monthly Visits, Pages per Visit, Average Visit Duration and Bounce Rate map to canonical fields. Unsupported columns are dropped, not copied into reports. Conflicting aliases are rejected.

Maximum **1,000 observations and 2 MiB**, including JSON contents. Identical observations are deduplicated. Conflicting domain/month/scope observations reject the complete export before a result write. Selected domains follow first input occurrence, retain their supplied history and disclose omitted-domain counts. Do not mix different providers in one import.

## Honest Comparisons and Reports

- Trends use only the supplied observations. This release does not maintain persistent history or automatically refresh source data.
- Comparisons require matching provider, country, traffic type and estimated/measured basis. Missing context disables changes.
- Gaps are explicit: non-adjacent observations are not called month-over-month growth.
- Percentage visits growth is unknown when the prior value is zero or missing. Rank changes use current minus previous (negative means improvement). Bounce changes are **percentage points**.
- Competitor shares use only saved domains in the same month/context. They are **included-domain shares, not market shares** or complete industry coverage.
- A US country label is user-provided scope, not proof of audience location. Worldwide traffic to a US company is not US-only traffic.

Import dataset rows contain one analysis per domain with source `user-authorized-import`, provider label, normalized observations, context-quality counts and within-export trends. Optional API rows retain `similarweb-official-api` and their existing flat fields.

Import mode writes `TRAFFIC_IMPORT_REPORT` (JSON), `TRAFFIC_COMPARISON.csv`, `TRAFFIC_REPORT.md` and `RUN_STATUS`. Reports contain only successfully saved domains, never unpaid/unsaved domains. Formula-like string cells are neutralized; raw rejected values and discarded secret columns are not exported. Delivery failures are reported honestly and no persistent history is modified. Previously saved results retain normal charges.

### Configure Your Agency Review

| Input | Default if omitted | Meaning |
| --- | ---: | --- |
| `reportFocusCountry` | `us` | Country-scope audit focus only; never changes/filters imported observations |
| `visitChangeAlertPercent` | `20` | Absolute adjacent-month visits change threshold, in percent |
| `bounceIncreaseAlertPoints` | `5` | Adjacent-month bounce increase threshold, in percentage points |
| `rankWorseningAlertPercent` | `20` | Adjacent-month global-rank numerical increase threshold, in percent |

Alerts require adjacent months and matching full comparison context. Unknown metrics, a zero visits baseline or gaps do not generate that metric's monthly signal. For example, rank 100 → 130 is 30% worse; bounce 45% → 52% is +7 percentage points. Findings use the threshold against unrounded change values, then display changes to six decimals. No automated schedule or outbound notification is created.

Additional import reports: `TRAFFIC_AGENCY_REPORT` contains options, coverage summary, alerts and observation-level quality; `TRAFFIC_ALERTS.csv` contains prior/current evidence and threshold units; `TRAFFIC_QUALITY.csv` contains missing fields/context, month gaps, focus status and peer coverage. A headers-only alerts CSV means no qualifying findings, not missing output. Reports check only saved domains, not omitted/unaffordable domains or the entire market.

`RUN_STATUS` distinguishes complete selected delivery from a partial spending-limit stop. If the final requested result exactly exhausts the fee budget, the outcome is `succeeded`, `completeSelectedOutput` is true and `spendingLimitReached` remains true. A denied/unaffordable selected result instead leaves an honest nonzero `unsavedSelectedDomainCount` and spending-limit outcome.

## Optional Official API Workflow

> **Experimental, live access unverified:** this route is covered by mocked unit tests, not a successful real-key run. Your subscription must authorize the requested endpoints and use. The verified demo/import offering does not establish live API access, data completeness or API-mode profitability.

### What You Need for API Mode

- A Similarweb account with **API access** and an **API key**. You can find your key in your Similarweb account (Account settings > API, or as provided by your Similarweb plan). See the official Similarweb API documentation for details.
- Each domain lookup consumes **your own Similarweb API credits**, in addition to Apify usage.

### What API Mode Extracts

For each domain, when your Similarweb plan returns the data:

- Domain
- Global rank
- Category rank and category
- Estimated monthly visits (latest month in the selected range)
- Pages per visit
- Average visit duration (seconds)
- Bounce rate (percent)
- Country scope, date range, SimilarWeb profile URL, and scraped timestamp

Any metric your subscription does not include, or that Similarweb has no data for, is returned as `null`. The Actor never fabricates values.

### Official API Input

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `apiKey` | string (secret) | Yes | – | Your official Similarweb API key. |
| `domains` | string array | Yes | `["openai.com"]` | Domains to look up, without `https://` or `www.`. |
| `maxResults` | integer | No | `1` | Max domains from the list to query. Each domain uses your Similarweb credits. |
| `country` | string | No | `world` | `world` or a two-letter ISO country code (e.g. `us`, `gb`, `in`), if included in your plan. |
| `startDate` | string | No | recent month | Start month `YYYY-MM` for traffic/engagement metrics. |
| `endDate` | string | No | recent month | End month `YYYY-MM`. The latest available value in the range is kept. |

### Official API Example Input

```json
{
  "mode": "official-api",
  "apiKey": "YOUR_SIMILARWEB_API_KEY",
  "domains": ["openai.com"],
  "maxResults": 1,
  "country": "world"
}
```

### Official API Output Shape

Values below are illustrative; real values come from your Similarweb API response. Missing metrics are `null`.

```json
{
  "domain": "openai.com",
  "country": "world",
  "startDate": "2026-03",
  "endDate": "2026-05",
  "globalRank": 201,
  "categoryRank": 6,
  "category": "Computers_Electronics_and_Technology",
  "monthlyVisits": 210500000,
  "pagesPerVisit": 2.81,
  "avgVisitDuration": 144.79,
  "bounceRate": 58.2,
  "source": "similarweb-official-api",
  "similarWebUrl": "https://www.similarweb.com/website/openai.com/",
  "scrapedAt": "2026-07-02T20:00:00.000Z"
}
```

## Pricing: Domain Results, Actor Start and Your API Credits

This Actor uses Apify Pay Per Event pricing:

| Event | Price |
| --- | ---: |
| `website-scraped` | `$0.002` per saved website analysis, or `$2.00` per 1,000 |
| `apify-actor-start` | `$0.00005` per GB when the Actor starts, minimum one event |

The result event applies once per saved domain analysis: authorized imported numeric observations or official Similarweb API metrics. Import months, observations, comparisons and report files do not create extra result events. Invalid import input, domains with no API data, failed requests and unsaved domains do not trigger `website-scraped`. Domains saved before a partial failure retain normal result charges. The Actor does not certify user-provided metrics as authentic.

The Actor Start fee can still apply to empty or failed runs, including rejected API keys. Apify counts one start event per GB of memory, with at least one event; the unchanged 1024 MB default therefore has a `$0.00005` start-event fee.

Import makes no Similarweb requests and consumes no Similarweb API credits. Official API mode uses your separate Similarweb subscription/credits; requests can consume your credits even when some metrics are unavailable. See the [live Pricing tab](https://apify.com/fascinating_lentil/similarweb-traffic-scraper/pricing) for authoritative current/future events, discounts and whether platform usage is included or added. The result price applies to both workflows; no separate import/API result events are added. Memory remains 1024 MB.

At the default memory, one saved domain has listed events of **$0.00205**, and two saved domains **$0.00405**, including the start event. Demo has zero website-result fees but may still cost the start event and platform usage. These are event examples, not a no-cost demo or a guaranteed all-in quote. Profitability estimates from small owner tests are not income, scale or customer-reliability guarantees; changed reporting logic requires fresh cost verification.

## How Official API Mode Works

1. Validates input and fails fast if no API key is provided (before any network request or website-scraped billing).
2. Normalizes and deduplicates the domain list.
3. Checks remaining result budget before each domain's external requests; each domain uses at most six official Similarweb metric requests, with a 30-second timeout and no automatic retry.
4. Maps only the values the API actually returns into a clean, nullable-safe record.
5. Saves and charges one `website-scraped` event **only** when at least one real metric was returned.
6. Fails clearly if no usable metrics are returned for any requested domain, so the run never appears as a successful empty dataset.
7. Stops immediately if the account spending limit is reached, and fails fast with a clear message if the API key is rejected (HTTP 401).

## Known Limits

- Live Similarweb retrieval requires a valid API subscription/key. Import provides analysis of supplied data, not automatic retrieval; no-key scraping is not added.
- Available metrics, countries, and history depend on your Similarweb plan. Endpoints not in your plan return `null` for those fields.
- Similarweb data typically lags the current month by one to two months.
- This Actor is not affiliated with Similarweb.
- The optional API route is unit-tested with mocked responses, but this release does not establish live key/plan access or its recurring profitability. Six concurrent requests may already be in flight when an authentication rejection is returned. Import/demo success does not verify API mode.

## Responsible Use

Process only exports you are permitted to use with this Actor. Similarweb's [terms](https://www.similarweb.com/corp/legal/terms/) restrict automated collection and data sharing unless expressly permitted. A permissions checkbox is not a licence to redistribute data. API customers must comply with their subscriptions/terms; import users remain responsible for source rights and accuracy. Do not include passwords, tokens or personal contacts in exports. This independent Actor is not affiliated with or endorsed by Similarweb. No source-rights, conversion, reliability or profitability guarantee is provided.

## License

Apache-2.0. See `LICENSE`.
