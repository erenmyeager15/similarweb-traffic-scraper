import { describe, expect, it } from 'vitest';
import { parseSimilarWebPageForTest } from './routes.js';

describe('parseSimilarWebPageForTest', () => {
  it('extracts public SimilarWeb metrics from visible page text', () => {
    const record = parseSimilarWebPageForTest('openai.com', `
      Global Rank
      #201

      Country Rank
      #93

      Category Rank
      #6
      AI Chatbots (In Computers Electronics and Technology)

      Total Visits Last 3 Months
      203.1M

      Avg Visit Duration
      00:02:24

      Pages per Visit
      2.81

      Bounce Rate
      58.2%
    `);

    expect(record).toMatchObject({
      domain: 'openai.com',
      globalRank: 201,
      countryRank: 93,
      categoryRank: 6,
      categoryName: 'AI Chatbots',
      monthlyVisits: '203100000',
      visitDuration: 144,
      pagesPerVisit: 2.81,
      bounceRate: 58.2,
    });
  });
});
