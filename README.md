# SimilarWeb Scraper — Extract Website Traffic & Analytics

Scrape public website traffic data, analytics overview, traffic sources, top countries, and more from SimilarWeb. Get competitor insights without an expensive SimilarWeb subscription.

## Features

- Extract public website traffic data from SimilarWeb overview pages
- Get global rank, monthly visits, bounce rate, visit duration, pages per visit
- Retrieve traffic sources breakdown (direct, search, social, referral, email, display)
- Identify top source countries with traffic percentages
- Find top referring domains, search keywords, and social networks
- Detect technologies used by websites (CMS, analytics, ad networks)
- Support for multiple domains in a single run
- Automatic deduplication by domain
- Built-in proxy rotation and anti-bot measures

## Use Cases

1. **Competitor Research**: Analyze competitor traffic volumes and sources to benchmark your own performance
2. **Digital Marketing Analysis**: Identify which channels drive the most traffic to target websites
3. **SEO Strategy**: Discover top search keywords and referral sources for content planning
4. **Investor Due Diligence**: Validate website traffic claims with independent third-party data
5. **Market Sizing**: Estimate market opportunity by analyzing traffic across industry players

## How It Works

1. Enter a list of website domains
2. The scraper visits SimilarWeb's public overview page for each domain
3. Data is extracted from the publicly visible sections
4. Results are saved to the Apify Dataset in JSON format

## Sample Output

```json
{
  "domain": "amazon.com",
  "globalRank": 11,
  "countryRank": null,
  "categoryRank": 1,
  "categoryName": "E-commerce and Shopping",
  "monthlyVisits": "2.7B",
  "visitDuration": 312,
  "pagesPerVisit": 8.9,
  "bounceRate": 32.5,
  "trafficChangeMoM": 2.3,
  "topCountries": [
    { "country": "United States", "trafficPercentage": 85.2 },
    { "country": "Germany", "trafficPercentage": 3.1 },
    { "country": "United Kingdom", "trafficPercentage": 2.8 }
  ],
  "trafficSources": {
    "direct": 65.2,
    "search": 22.1,
    "social": 3.5,
    "referral": 5.8,
    "email": 2.1,
    "displayAds": 1.3
  },
  "topReferringDomains": [
    { "domain": "google.com", "sharePercentage": 42.1 },
    { "domain": "facebook.com", "sharePercentage": 12.3 }
  ],
  "topSearchKeywords": [
    { "keyword": "amazon", "sharePercentage": 35.2 },
    { "keyword": "amazon prime", "sharePercentage": 8.1 }
  ],
  "topSocialNetworks": [
    { "platform": "Facebook", "sharePercentage": 45.2 },
    { "platform": "YouTube", "sharePercentage": 28.3 }
  ],
  "technologies": [
    { "name": "React", "category": "JavaScript Frameworks" },
    { "name": "Google Analytics", "category": "Analytics" }
  ],
  "similarWebUrl": "https://www.similarweb.com/website/amazon.com/",
  "scrapedAt": "2026-06-10T08:30:00.000Z"
}
```

## Pricing

| Feature | Cost |
|---------|------|
| Per website scraped | $0.005 (Pay-Per-Event) |
| Monthly subscription | Free (pay only for usage) |
| Proxy costs | Included via Apify Proxy |

**Premium value for digital agencies**: Traffic intelligence data that would cost hundreds per month from SimilarWeb directly, available at a fraction of the cost.

## Public Data Limitations

This scraper extracts only publicly visible data from SimilarWeb overview pages. Detailed breakdowns (historical trends, granular keyword data, competitor comparisons) require a paid SimilarWeb account. Fields that are behind SimilarWeb's login wall will return `null` with an appropriate log message.

## Input

```json
{
  "domains": ["amazon.com", "flipkart.com", "myntra.com"],
  "maxResults": 5,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Output

Results are saved to the Apify Dataset. Each item contains the full `WebsiteRecord` object with all extracted fields.

## Requirements

- Apify account
- Residential proxy (recommended for reliable scraping)
- Node.js 20+ (for local development)

## License

Apache 2.0
