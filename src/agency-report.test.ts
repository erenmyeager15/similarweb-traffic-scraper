import { describe, expect, it } from 'vitest';
import { agencyAlertsCsv, agencyMarkdown, agencyOptions, agencyQualityCsv, buildAgencyReport } from './agency-report.js';
import { parseCsv, prepareImport } from './importer.js';

const base = { domain: 'example.com', month: '2026-08', country: 'us', trafficType: 'all-traffic', measurementType: 'estimated',
    monthlyVisits: 1000, bounceRate: 45, globalRank: 100, categoryRank: 5, category: 'Software', pagesPerVisit: 2, avgVisitDuration: 120 };
const current = { ...base, month: '2026-09', monthlyVisits: 700, bounceRate: 52, globalRank: 130 };
const records = (rows: unknown[] = [base, current], provider = 'Synthetic agency QA') => prepareImport({
    mode: 'import', authorizedData: true, importSource: provider, maxResults: 10, importRecords: rows,
}).records;
const report = (rows: unknown[] = [base, current], options = {}) => buildAgencyReport(records(rows), agencyOptions(options));

describe('agency option validation', () => {
    it('provides reporting defaults without changing imported scope', () => expect(agencyOptions({})).toEqual({
        focusCountry: 'us', visitChangeAlertPercent: 20, bounceIncreaseAlertPoints: 5, rankWorseningAlertPercent: 20,
    }));
    it('normalizes an explicit report focus', () => expect(agencyOptions({ reportFocusCountry: ' GB ' }).focusCountry).toBe('gb'));
    it('supports an explicit world focus', () => expect(agencyOptions({ reportFocusCountry: 'world' }).focusCountry).toBe('world'));
    it.each([null, [], 'bad', 1])('rejects invalid option containers %j', (input) => expect(() => agencyOptions(input)).toThrow());
    it.each(['usa', '', 'United States', 10, false])('rejects invalid focus %j', (reportFocusCountry) => expect(() => agencyOptions({ reportFocusCountry })).toThrow(/reportFocusCountry/));
    it.each(['visitChangeAlertPercent', 'bounceIncreaseAlertPoints', 'rankWorseningAlertPercent'])('validates numeric bounds for %s', (field) => {
        for (const value of [0, -1, '20', NaN, Infinity, false, 1001]) expect(() => agencyOptions({ [field]: value })).toThrow(field);
        expect(agencyOptions({ [field]: 0.1 })).toHaveProperty(field, 0.1);
    });
    it('bounds bounce thresholds in percentage points', () => expect(() => agencyOptions({ bounceIncreaseAlertPoints: 100.1 })).toThrow());
});

describe('evidence-based monthly review signals', () => {
    it('identifies three threshold signals with exact prior/current evidence and units', () => {
        const result = report();
        expect(result.alerts).toHaveLength(3);
        expect(result.alerts[0]).toMatchObject({ rule: 'visits_drop', previousValue: 1000, currentValue: 700, change: -30, unit: 'percent' });
        expect(result.alerts[1]).toMatchObject({ rule: 'bounce_rate_increase', previousValue: 45, currentValue: 52, change: 7, unit: 'percentage_points' });
        expect(result.alerts[2]).toMatchObject({ rule: 'global_rank_worsening', previousValue: 100, currentValue: 130, change: 30, unit: 'percent' });
        expect(result.alerts.every((row) => row.requiresReview && row.source === 'user-authorized-import')).toBe(true);
    });
    it('reports growth separately and does not treat improving ranks/bounce as worsening', () => {
        const result = report([base, { ...current, monthlyVisits: 1200, bounceRate: 40, globalRank: 80 }]);
        expect(result.alerts.map((row) => row.rule)).toEqual(['visits_growth']);
    });
    it('honors higher configured thresholds', () => expect(report(undefined, {
        visitChangeAlertPercent: 50, bounceIncreaseAlertPoints: 10, rankWorseningAlertPercent: 50,
    }).alerts).toEqual([]));
    it('includes an exact threshold boundary', () => expect(report([base, { ...base, month: '2026-09', monthlyVisits: 800 }]).alerts[0].change).toBe(-20));
    it('does not alert solely because a displayed delta rounded up', () => expect(report([base, {
        ...base, month: '2026-09', bounceRate: 49.9999999,
    }]).alerts).toEqual([]));
    it('retains full-precision original evidence for a bounce signal', () => {
        const result = report([{ ...base, bounceRate: 45.123456789 }, { ...base, month: '2026-09', bounceRate: 52.234567891 }]);
        expect(result.alerts[0]).toMatchObject({ previousValue: 45.123456789, currentValue: 52.234567891 });
    });
    it('does not alert across period gaps', () => {
        const result = report([base, { ...current, month: '2026-10' }]);
        expect(result.alerts).toEqual([]); expect(result.summary.periodGapCount).toBe(1);
    });
    it.each([{ country: 'gb' }, { trafficType: 'desktop' }, { measurementType: 'measured' }])('does not compare changed scope %j', (extra) => expect(report([base, { ...current, ...extra }]).alerts).toEqual([]));
    it.each(['country', 'trafficType', 'measurementType'])('does not alert with missing %s', (field) => expect(report([{ ...base, [field]: null }, { ...current, [field]: null }]).alerts).toEqual([]));
    it('does not divide by a zero visit baseline', () => expect(report([{ ...base, monthlyVisits: 0 }, { ...base, month: '2026-09' }]).alerts).toEqual([]));
    it('preserves unknown metric changes', () => expect(report([{ ...base, monthlyVisits: null }, { ...base, month: '2026-09' }]).alerts).toEqual([]));
    it('does not create change signals from a single observation', () => expect(report([current]).alerts).toEqual([]));
});

describe('US scope and comparison-quality checks', () => {
    it('does not turn worldwide, unknown or other-country observations into US data', () => {
        const result = report([base, { ...base, country: 'world' }, { ...base, country: null }, { ...base, country: 'gb' }]);
        expect(result.summary).toMatchObject({ focusCountryObservationCount: 1, differentCountryObservationCount: 2, unknownCountryObservationCount: 1 });
        expect(result.quality.map((row) => row.country).sort()).toEqual([null, 'gb', 'us', 'world'].sort());
    });
    it('separates complete fields from source accuracy/rights', () => {
        const result = report([base]);
        expect(result.quality[0].qualityStatus).toBe('complete_fields');
        expect(result.notices.join(' ')).toContain('does not mean accurate or licensed');
        expect(result.summary.upstreamDataVerified).toBe(false);
    });
    it('lists missing metrics and context without inventing values', () => {
        const result = report([{ domain: 'example.com', month: '2026-09', monthlyVisits: 0 }]);
        expect(result.quality[0]).toMatchObject({ metricCount: 1, missingContext: ['country', 'trafficType', 'measurementType'], qualityStatus: 'context_missing' });
        expect(result.quality[0].missingMetrics).toHaveLength(5);
    });
    it('recognizes matching peers only in the same period and scope', () => {
        const result = report([base, current, { ...current, domain: 'example.net', monthlyVisits: 1400 }]);
        expect(result.summary.latestScopesWithoutMatchedVisitPeers).toBe(0);
        expect(result.quality.filter((row) => row.isLatestSuppliedInScope).every((row) => row.comparisonPeerCount === 2)).toBe(true);
    });
    it('does not match mismatched reporting periods', () => expect(report([base, { ...current, domain: 'example.net' }]).summary.latestScopesWithoutMatchedVisitPeers).toBe(2));
    it('does not match estimated and measured peers', () => expect(report([base, { ...base, domain: 'example.net', measurementType: 'measured' }]).summary.latestScopesWithoutMatchedVisitPeers).toBe(2));
    it('identifies the latest supplied month per scope without claiming current freshness', () => {
        const result = report([base, current, { ...base, month: '2026-07', country: 'world' }]);
        expect(result.quality.filter((row) => row.isLatestSuppliedInScope)).toHaveLength(2);
        expect(result.notices.join(' ')).toContain('not fresh or current');
    });
    it('accepts an empty saved set without reporting unsaved data', () => {
        const result = buildAgencyReport([], agencyOptions({}));
        expect(result.summary.savedDomainCount).toBe(0); expect(result.alerts).toEqual([]); expect(result.quality).toEqual([]);
    });
});

describe('agency JSON/CSV/Markdown provenance and safety', () => {
    it('labels every synthetic preview row', () => {
        const result = buildAgencyReport(records(), agencyOptions({}), { source: 'synthetic-demo', isSynthetic: true });
        expect([...result.quality, ...result.alerts].every((row) => row.isSynthetic && row.source === 'synthetic-demo')).toBe(true);
    });
    it('provides parseable quality and signal CSVs', () => {
        const result = report();
        expect(parseCsv(agencyAlertsCsv(result))).toHaveLength(3);
        expect(parseCsv(agencyQualityCsv(result))).toHaveLength(2);
    });
    it('emits only CSV headers when there are no alerts', () => expect(agencyAlertsCsv(report([base])).split('\r\n')).toHaveLength(1));
    it('neutralizes formula-like provider labels in both CSVs', () => {
        const result = buildAgencyReport(records(undefined, '=PRIVATE_FORMULA()'), agencyOptions({}));
        expect(agencyAlertsCsv(result)).toContain("'=PRIVATE_FORMULA()"); expect(agencyQualityCsv(result)).toContain("'=PRIVATE_FORMULA()");
    });
    it('keeps provider HTML/links out of the agency Markdown checklist', () => {
        const result = buildAgencyReport(records(undefined, '<script>[bad](https://secret.example)</script>'), agencyOptions({}));
        expect(agencyMarkdown(result)).not.toContain('<script>'); expect(agencyMarkdown(result)).not.toContain('https://secret.example');
    });
    it('does not retain discarded secrets in additional reports', () => {
        const result = report([{ ...base, apiKey: 'DO_NOT_EXPORT' }, current]);
        expect(JSON.stringify(result) + agencyAlertsCsv(result) + agencyQualityCsv(result)).not.toContain('DO_NOT_EXPORT');
    });
    it('explains reporting limits without claiming monitoring or causation', () => {
        expect(agencyMarkdown(report())).toContain('No automatic notification, schedule or causal inference');
        expect(report().summary.persistentHistoryWritten).toBe(false);
    });
});
