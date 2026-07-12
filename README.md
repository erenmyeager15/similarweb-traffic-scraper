# SimilarWeb Scraper - Website Traffic & Analytics

Get estimated website traffic, engagement, rankings, category, and traffic-channel shares for a list of domains. The default public-data mode does not require an API key. You can optionally provide your own Similarweb API key to use the official API mode.

## What It Extracts

- Global, country, and category rank
- Category name
- Estimated monthly visits
- Pages per visit
- Average visit duration in seconds
- Bounce rate
- Direct, organic/paid search, organic/paid social, referral, email, display, generative-AI, and affiliate traffic shares when available
- Metric month, source mode, Similarweb profile URL, and scrape timestamp

Missing values are returned as `null`. The Actor never invents traffic estimates.

## Input

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `domains` | Yes | `["github.com"]` | Domains without `https://` or `www.`. |
| `maxResults` | No | `1` | Maximum domains to process. |
| `apiKey` | No | none | Your official Similarweb API key. Adding it selects official API mode. |
| `country` | No | `world` | Official API mode country scope. |
| `startDate` | No | recent range | Official API mode start month (`YYYY-MM`). |
| `endDate` | No | recent range | Official API mode end month (`YYYY-MM`). |
| `proxyConfiguration` | No | US Residential | Used only when public-data access is regionally blocked. |

## No-Key Example

```json
{
  "domains": ["github.com"],
  "maxResults": 1,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "US"
  }
}
```

The Actor first tries the public endpoint directly. It uses the configured proxy only when the direct request is blocked or rate-limited.

## Official API Example

```json
{
  "apiKey": "YOUR_SIMILARWEB_API_KEY",
  "domains": ["github.com"],
  "maxResults": 1,
  "country": "world"
}
```

Official API availability, countries, history, and credits depend on your Similarweb subscription.

## Example Output

```json
{
  "domain": "github.com",
  "country": "us",
  "startDate": "2026-05",
  "endDate": "2026-05",
  "globalRank": 71,
  "countryRank": 86,
  "categoryRank": 2,
  "category": "Computers_Electronics_and_Technology",
  "monthlyVisits": 498123456,
  "pagesPerVisit": 5.27,
  "avgVisitDuration": 412.4,
  "bounceRate": 44.6,
  "trafficSources": {
    "direct": 51.2,
    "organicSearch": 33.1,
    "paidSearch": 0.4,
    "organicSocial": 8.1,
    "paidSocial": 0.2,
    "referrals": 5.6,
    "email": 0.8,
    "displayAds": 0.3,
    "genAi": 0.2,
    "affiliate": 0.1
  },
  "source": "similarweb-public-data",
  "similarWebUrl": "https://www.similarweb.com/website/github.com/",
  "scrapedAt": "2026-07-12T12:00:00.000Z"
}
```

Example values are illustrative. Actual output comes from the live source.

## Pricing and Reliability

The Actor charges one `website-scraped` event only when a domain returns at least one real metric and the row is saved atomically. Failed requests, blocked requests, invalid API keys, and empty responses do not trigger that event.

Public-data mode depends on a public Similarweb endpoint and may be unavailable, rate-limited, regionally blocked, or changed without notice. For production workloads that require contractual stability, use your official Similarweb API key.

## Responsible Use

Use the Actor in accordance with Similarweb's terms and applicable laws. This Actor is not affiliated with Similarweb.

## License

Apache-2.0. See `LICENSE`.
