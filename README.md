# SimilarWeb Scraper - Website Traffic & Analytics

Scrape public SimilarWeb website traffic data for one or more domains, including global rank, category rank, estimated monthly visits, engagement metrics, bounce rate, and SimilarWeb profile URLs. Export clean results to JSON, CSV, Excel, or HTML, or pull them through the Apify API.

For a fast, low-cost first run, use the default sample input: `openai.com` with `maxResults: 1`.

## What It Extracts

For each website domain, the Actor can return:

- Domain
- Global rank, country rank, and category rank
- Category name
- Estimated monthly visits
- Visit duration, pages per visit, and bounce rate
- Top source countries when available
- Traffic-source breakdown when available
- SimilarWeb profile URL
- Scraped timestamp

Some advanced fields, such as referring domains, search keywords, social networks, technologies, or month-over-month traffic change, depend on what SimilarWeb exposes publicly and may be returned as `null` or empty arrays.

## Use Cases

- Competitor website traffic research
- SEO and market research
- Website benchmark reports
- Investor or startup traffic checks
- Agency research for client websites
- Market sizing from public traffic estimates

## Pricing and Usage

This Actor uses Apify Pay Per Event pricing. You are charged once per website that is successfully scraped and saved with data. Blocked or not-found domains are not charged as website records.

Apify platform compute and proxy usage may be billed separately depending on your plan and run settings. Residential proxies are recommended for SimilarWeb reliability, but they may add proxy usage cost.

Cost-control tips:

- Start with one domain and `maxResults: 1`.
- Test with a reliable domain such as `openai.com`.
- Increase domain volume only after the sample output looks correct.
- Use your Apify run cost limit for larger batches.

## Input

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `domains` | string array | Yes | `["openai.com"]` | Website domains to scrape. Enter domains without `https://` or `www.`. |
| `maxResults` | integer | No | `1` | Maximum number of domains to scrape from the list. |
| `proxyConfiguration` | object | No | Residential Apify Proxy | Proxy settings. Residential proxies are recommended for reliability. |

## Example Input

```json
{
  "domains": ["openai.com"],
  "maxResults": 1,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Output Example

```json
{
  "domain": "openai.com",
  "globalRank": 201,
  "countryRank": null,
  "categoryRank": 6,
  "categoryName": "ai_chatbots_and_tools",
  "monthlyVisits": "203086642",
  "visitDuration": 144.79,
  "pagesPerVisit": 2.81,
  "bounceRate": 58.2,
  "trafficChangeMoM": null,
  "topCountries": [],
  "trafficSources": {
    "direct": null,
    "search": null,
    "social": null,
    "referral": null,
    "email": null,
    "displayAds": null
  },
  "topReferringDomains": [],
  "topSearchKeywords": [],
  "topSocialNetworks": [],
  "technologies": [],
  "similarWebUrl": "https://www.similarweb.com/website/openai.com/",
  "scrapedAt": "2026-06-21T13:11:18.000Z"
}
```

## How It Works

1. Normalizes each domain by removing protocols, `www.`, and paths.
2. Validates and deduplicates the domain list.
3. Requests the public SimilarWeb website page for each domain.
4. Parses visible rank, traffic, and engagement fields, with JSON parsing kept for compatible responses.
5. Saves each clean website record to the Apify Dataset with the `website-scraped` event.

## Known Limits

- SimilarWeb traffic values are public third-party estimates, not official analytics from the target website.
- Some domains may return no public data or may be temporarily blocked.
- Residential proxies are recommended for reliable live results.
- This Actor is not affiliated with SimilarWeb.

## Responsible Use

This Actor is intended for lawful collection of publicly available information only. Users are responsible for ensuring their use complies with source website terms, robots.txt, privacy laws, and local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0. See `LICENSE`.
