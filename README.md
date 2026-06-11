# SimilarWeb Website Traffic Scraper - Rank, Visits & Traffic Sources

Scrape public SimilarWeb website traffic data — global rank, monthly visits, engagement metrics, traffic sources, and top countries — for any list of domains. Get competitor traffic insights without an expensive SimilarWeb subscription, and export to JSON, CSV, Excel, or HTML, or pull via the Apify API — no SimilarWeb login and no API key required.

This SimilarWeb scraper reads each domain's public traffic data, validates and deduplicates your domain list automatically, and runs through residential proxies with anti-bot retries so results stay reliable. Every clean record is saved to the Apify Dataset, ready to export or feed into your own analysis.

## What It Extracts

For each domain (one record in the dataset):

- `domain`
- `globalRank`, `countryRank`, `categoryRank`
- `categoryName`
- `monthlyVisits` (estimated visits)
- `visitDuration` (average, seconds), `pagesPerVisit`, `bounceRate`
- `topCountries` — top source countries with traffic percentage
- `trafficSources` — breakdown of `direct`, `search`, `social`, `referral`, `email`, `displayAds`
- `similarWebUrl` — link to the SimilarWeb profile page
- `scrapedAt` timestamp

The output record also includes `trafficChangeMoM`, `topReferringDomains`, `topSearchKeywords`, `topSocialNetworks`, and `technologies` fields. These are part of the schema but are not provided by the public data endpoint, so they are currently returned as `null` or empty arrays (see Known Limits).

## Use Cases

1. **Competitor research**: Benchmark competitor traffic volume and channel mix against your own performance.
2. **Digital marketing analysis**: See which channels (direct, search, social, referral, email, display) drive traffic to target websites.
3. **SEO and market strategy**: Compare global, country, and category rank across a set of domains to prioritize where to compete.
4. **Investor due diligence**: Validate website traffic claims with independent third-party estimates before investing.
5. **Market sizing**: Estimate market opportunity by scraping traffic across an entire list of industry players in one run.

## Pricing

This Actor uses Apify Pay Per Event pricing. You are charged once per website that is successfully scraped and saved with data — blocked or not-found domains are not billed. Apify platform compute and proxy usage are billed separately by Apify.

| Event name | Price per event | 1,000 websites | 10,000 websites |
| --- | ---: | ---: | ---: |
| `website-scraped` | $0.005 | $5.00 | $50.00 |

## Input

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `domains` | string[] | Yes | `["amazon.com"]` | Website domains to scrape (e.g. `amazon.com`). Enter without `https://` or `www.`. |
| `maxResults` | integer | No | `10` | Maximum number of domains to scrape from the list (1–1000). |
| `proxyConfiguration` | object | No | `{ useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] }` | Proxy settings. Residential proxies are strongly recommended for SimilarWeb. |

## How to Scrape SimilarWeb (Step by Step)

1. Click **Try for free** / **Run**.
2. Add the domains you want to analyze to `domains` (e.g. `amazon.com`, `flipkart.com`) — no `https://` or `www.` needed.
3. Set `maxResults` to cap how many domains run (start small to test).
4. Keep residential proxies enabled and run the Actor.
5. Export results from the Apify Dataset as JSON, CSV, Excel, or HTML, or pull them via the Apify API.

## Sample Output

```json
{
  "domain": "amazon.com",
  "globalRank": 11,
  "countryRank": null,
  "categoryRank": 1,
  "categoryName": "E-commerce and Shopping",
  "monthlyVisits": "2700000000",
  "visitDuration": 312,
  "pagesPerVisit": 8.9,
  "bounceRate": 32.5,
  "trafficChangeMoM": null,
  "topCountries": [
    { "country": "US", "trafficPercentage": 85.2 },
    { "country": "DE", "trafficPercentage": 3.1 },
    { "country": "GB", "trafficPercentage": 2.8 }
  ],
  "trafficSources": {
    "direct": 65.2,
    "search": 22.1,
    "social": 3.5,
    "referral": 5.8,
    "email": 2.1,
    "displayAds": 1.3
  },
  "topReferringDomains": [],
  "topSearchKeywords": [],
  "topSocialNetworks": [],
  "technologies": [],
  "similarWebUrl": "https://www.similarweb.com/website/amazon.com/",
  "scrapedAt": "2026-06-10T08:30:00.000Z"
}
```

## How It Works

1. Normalizes each domain (strips `https://`, `www.`, and paths), validates it, and removes duplicates.
2. Requests SimilarWeb's public JSON data endpoint (`data.similarweb.com/api/v1/data`) for each domain through residential proxies — more reliable than the Cloudflare-gated, login-walled website DOM.
3. Parses rank, engagement, traffic sources, and top countries from the response.
4. Saves the clean `WebsiteRecord` to the Apify Dataset.
5. Charges `website-scraped` once the record is saved. Blocked or empty responses are skipped without charging.

## Known Limits

- Only **public** traffic estimates are returned. Detailed breakdowns behind SimilarWeb's login wall are not available.
- `topReferringDomains`, `topSearchKeywords`, `topSocialNetworks`, and `technologies` are included in the output schema but are **not supplied by the public data endpoint**, so they are currently returned as empty arrays. `trafficChangeMoM` is returned as `null` for the same reason.
- `topCountries` reports ISO country codes (e.g. `US`, `DE`, `GB`) rather than full country names.
- `monthlyVisits` is an estimated value returned as a numeric string. Percentage fields are rounded to one decimal place.
- SimilarWeb may block automated traffic; residential proxies are strongly recommended and domains that return no data are skipped (and not billed).

## License

Apache-2.0. See `LICENSE`.
