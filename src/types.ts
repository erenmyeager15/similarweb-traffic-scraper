export interface ActorInput {
  domains: string[];
  maxResults?: number;
  proxyConfiguration?: {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
    apifyProxyCountry?: string;
  };
}

export interface CountryTraffic {
  country: string;
  trafficPercentage: number;
}

export interface TrafficSource {
  direct: number | null;
  search: number | null;
  social: number | null;
  referral: number | null;
  email: number | null;
  displayAds: number | null;
}

export interface ReferringDomain {
  domain: string;
  sharePercentage: number;
}

export interface SearchKeyword {
  keyword: string;
  sharePercentage: number;
}

export interface SocialNetwork {
  platform: string;
  sharePercentage: number;
}

export interface TechnologyItem {
  name: string;
  category: string;
}

export interface WebsiteRecord {
  domain: string;
  globalRank: number | null;
  countryRank: number | null;
  categoryRank: number | null;
  categoryName: string | null;
  monthlyVisits: string | null;
  visitDuration: number | null;
  pagesPerVisit: number | null;
  bounceRate: number | null;
  trafficChangeMoM: number | null;
  topCountries: CountryTraffic[];
  trafficSources: TrafficSource;
  topReferringDomains: ReferringDomain[];
  topSearchKeywords: SearchKeyword[];
  topSocialNetworks: SocialNetwork[];
  technologies: TechnologyItem[];
  similarWebUrl: string;
  scrapedAt: string;
}
