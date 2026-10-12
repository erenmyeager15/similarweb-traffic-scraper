# SimilarWeb Scraper - Website Traffic & Analytics (Official API)

Compare website traffic, rankings and engagement metrics for competitor benchmarking and SEO research. This independent Actor calls the **official Similarweb REST API** using **your own Similarweb API key**. Collect available global/category ranks, estimated monthly visits, pages per visit, visit duration and bounce rate, then export results to CSV, JSON, Excel or HTML, or retrieve them through the Apify API.

> Important: this is a bring-your-own-key Actor. It calls the official Similarweb API on your behalf and **does not scrape SimilarWeb public pages**. You need a valid Similarweb subscription/API key with API access. Runs without a key fail immediately and are **not** charged the website-scraped event.

## What You Need

- A Similarweb account with **API access** and an **API key**. You can find your key in your Similarweb account (Account settings > API, or as provided by your Similarweb plan). See the official Similarweb API documentation for details.
- Each domain lookup consumes **your own Similarweb API credits**, in addition to Apify usage.

## What It Extracts

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

## Input

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `apiKey` | string (secret) | Yes | – | Your official Similarweb API key. |
| `domains` | string array | Yes | `["openai.com"]` | Domains to look up, without `https://` or `www.`. |
| `maxResults` | integer | No | `1` | Max domains from the list to query. Each domain uses your Similarweb credits. |
| `country` | string | No | `world` | `world` or a two-letter ISO country code (e.g. `us`, `gb`, `in`), if included in your plan. |
| `startDate` | string | No | recent month | Start month `YYYY-MM` for traffic/engagement metrics. |
| `endDate` | string | No | recent month | End month `YYYY-MM`. The latest available value in the range is kept. |

## Example Input

```json
{
  "apiKey": "YOUR_SIMILARWEB_API_KEY",
  "domains": ["openai.com"],
  "maxResults": 1,
  "country": "world"
}
```

## Output Shape

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
| `website-scraped` | `$0.005` per domain with real saved data, or `$5.00` per 1,000 |
| `apify-actor-start` | `$0.00005` per GB when the Actor starts, minimum one event |

The website-result event applies once per domain that returns **real data** from the official Similarweb API. Domains with no data, failed API responses or an invalid/unauthorized API key do not trigger `website-scraped`. Domains already saved before a partial failure retain their normal result charges.

The Actor Start fee can still apply to empty or failed runs, including rejected API keys. Apify counts one start event per GB of memory, with at least one event; the unchanged 1024 MB default therefore has a `$0.00005` start-event fee.

Your Similarweb subscription/API credits are separate, required third-party costs and are not supplied by this Actor. API requests consume your own credits according to your Similarweb plan, even when some metrics are unavailable. See the [live Pricing tab](https://apify.com/fascinating_lentil/similarweb-traffic-scraper/pricing) for Apify event prices and whether platform usage is included or added. Start with one domain and `maxResults: 1` to confirm your key and plan coverage before larger batches; do not treat a result-event subtotal as an all-in API cost.

## How It Works

1. Validates input and fails fast if no API key is provided (before any network request or website-scraped billing).
2. Normalizes and deduplicates the domain list.
3. For each domain, calls the official Similarweb REST API endpoints for rank, category rank, visits, pages per visit, average visit duration, and bounce rate.
4. Maps only the values the API actually returns into a clean, nullable-safe record.
5. Saves and charges one `website-scraped` event **only** when at least one real metric was returned.
6. Fails clearly if no usable metrics are returned for any requested domain, so the run never appears as a successful empty dataset.
7. Stops immediately if the account spending limit is reached, and fails fast with a clear message if the API key is rejected (HTTP 401).

## Known Limits

- Requires a valid Similarweb API subscription and key. This Actor does not provide Similarweb data on its own.
- Available metrics, countries, and history depend on your Similarweb plan. Endpoints not in your plan return `null` for those fields.
- Similarweb data typically lags the current month by one to two months.
- This Actor is not affiliated with Similarweb.

## Responsible Use

Use only in accordance with your Similarweb API subscription and terms. You are responsible for ensuring your use complies with Similarweb's terms and applicable laws.

## License

Apache-2.0. See `LICENSE`.
