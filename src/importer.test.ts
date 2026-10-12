import { afterEach, describe, expect, it, vi } from 'vitest';
import { comparisonCsv, comparisonRows, csvCell, importMarkdown, MAX_IMPORT_BYTES, normalizeImportDomain, parseCsv, prepareImport, selectMode } from './importer.js';
import { runImportWorkflow } from './import-workflow.js';
import type { ImportPorts } from './import-workflow.js';

const base = { domain: 'example.com', month: '2026-08', country: 'us', trafficType: 'all-traffic', measurementType: 'estimated', monthlyVisits: 100, globalRank: 10, categoryRank: 5, category: 'Software', pagesPerVisit: 2, avgVisitDuration: 60, bounceRate: 50 };
const later = { ...base, month: '2026-09', monthlyVisits: 150, globalRank: 8, categoryRank: 4, pagesPerVisit: 3, avgVisitDuration: 80, bounceRate: 45 };
const input = (rows: unknown[] = [base, later], extra = {}) => ({ mode: 'import', authorizedData: true, importSource: 'Synthetic local QA fixture', importRecords: rows, maxResults: 10, ...extra });
function fakePorts() {
    const values = new Map<string, unknown>();
    const save = vi.fn(async () => ({ chargedCount: 1, eventChargeLimitReached: false }));
    const ports: ImportPorts = {
        canSave: vi.fn(() => true), save,
        write: vi.fn(async (key, value) => { values.set(key, value); }),
        status: vi.fn(async () => undefined),
    };
    return { values, save, ports };
}
afterEach(() => vi.unstubAllGlobals());

describe('no-key route and legacy compatibility', () => {
    it('selects import without an API key', () => expect(selectMode(input())).toBe('import'));
    it('keeps a legacy API task without mode on the API route', () => expect(selectMode({ apiKey: 'private-key', domains: ['example.com'] })).toBe('official-api'));
    it('gives actual import data priority over an unused API key', () => expect(selectMode({ ...input(), mode: undefined, apiKey: 'private-key' })).toBe('import'));
    it('does not select an API fallback for missing input data', () => expect(selectMode({})).toBe('import'));
    it('rejects API mode mixed with import data', () => expect(() => selectMode({ ...input(), mode: 'official-api' })).toThrow(/cannot also contain/));
    it('explicit import never falls back to a supplied API key', () => expect(() => prepareImport({ mode: 'import', apiKey: 'secret' })).toThrow(/authorizedData/));
    it.each([null, undefined, [], 'bad', 4])('rejects invalid input containers %j', (value) => expect(() => selectMode(value)).toThrow());
    it('rejects unsupported modes', () => expect(() => selectMode({ mode: 'public-page' })).toThrow(/mode/));
    it('does not expose credentials in validation errors', () => {
        expect(() => prepareImport({ ...input(), importRecords: [{ domain: 'https://user:SECRET@example.com', month: '2026-09' }] })).toThrow(/credentials/);
        try { prepareImport({ ...input(), importRecords: [{ domain: 'https://user:SECRET@example.com', month: '2026-09' }] }); } catch (error) { expect(String(error)).not.toContain('SECRET'); }
    });
});

describe('strict import contract', () => {
    it('requires an explicit rights confirmation', () => expect(() => prepareImport(input([base], { authorizedData: false }))).toThrow(/authorizedData/));
    it.each([undefined, '', ' ', 5, 'a\nlabel', 'x'.repeat(101)])('rejects missing/unsafe provider labels %j', (provider) => expect(() => prepareImport(input([base], { importSource: provider }))).toThrow(/importSource/));
    it('requires only one input format', () => expect(() => prepareImport(input([base], { importCsv: 'domain,month,visits\nexample.com,2026-09,1' }))).toThrow(/exactly one/));
    it('requires observations', () => expect(() => prepareImport(input([]))).toThrow(/1–1,000/));
    it('requires numeric metrics rather than identity-only rows', () => expect(() => prepareImport(input([{ domain: 'example.com', month: '2026-09' }]))).toThrow(/numeric/));
    it.each([null, [], 'text', 10])('rejects invalid row containers %j', (row) => expect(() => prepareImport(input([row]))).toThrow(/object/));
    it.each([0, -1, 1001, 1.1, '2', NaN, Infinity])('rejects invalid maxResults %j', (limit) => expect(() => prepareImport(input([base], { maxResults: limit }))).toThrow(/maxResults/));
    it('bounds the number of observations', () => expect(() => prepareImport(input(Array(1001).fill(base)))).toThrow(/1–1,000/));
    it('bounds JSON bytes before processing', () => expect(() => prepareImport(input([{ ...base, discarded: 'x'.repeat(MAX_IMPORT_BYTES) }]))).toThrow(/2 MiB/));
    it('ignores unknown private columns without retaining their contents', () => {
        const plan = prepareImport(input([{ ...base, apiKey: 'SECRET', email: 'private@example.com', constructor: 'bad' }]));
        expect(plan.unsupportedColumnsDropped).toBe(3);
        expect(JSON.stringify(plan)).not.toContain('SECRET');
        expect(JSON.stringify(plan)).not.toContain('private@example.com');
    });
    it('does not merge ambiguous aliases', () => expect(() => prepareImport(input([{ ...base, visits: 200 }]))).toThrow(/same field/));
    it('deduplicates identical observations but rejects conflicting ones', () => {
        expect(prepareImport(input([base, base])).duplicateObservationsRemoved).toBe(1);
        expect(() => prepareImport(input([base, { ...base, monthlyVisits: 101 }]))).toThrow(/conflicting/);
    });
    it('limits whole domains without discarding selected domain history', () => {
        const plan = prepareImport(input([base, { ...base, domain: 'example.net' }, later], { maxResults: 1 }));
        expect(plan.records).toHaveLength(1);
        expect(plan.records[0].observations).toHaveLength(2);
        expect(plan.omittedDomainCount).toBe(1);
    });
    it('accepts 1,000 valid observations within bounds', () => expect(prepareImport(input(Array.from({ length: 1000 }, (_, i) => ({ ...base, domain: `site${i}.example.com` })), { maxResults: 1000 })).records).toHaveLength(1000));
});

describe('domain, date and metric normalization', () => {
    it.each([['EXAMPLE.COM', 'example.com'], ['https://www.example.com/path?token=private', 'example.com'], ['bücher.de', 'xn--bcher-kva.de']])('normalizes %s without accessing it', (raw, expected) => expect(normalizeImportDomain(raw)).toBe(expected));
    it.each(['localhost', '127.0.0.1', '[::1]', 'ftp://example.com', 'https://name:secret@example.com', 'example.com:8443', '-bad.com', 'example..com'])('rejects unsafe/non-domain %s', (raw) => expect(() => normalizeImportDomain(raw)).toThrow());
    it('normalizes the standard HTTPS port without retaining it', () => expect(normalizeImportDomain('https://example.com:443')).toBe('example.com'));
    it.each(['2026-13', '2026-00', '2026-09garbage', 'August 2026', '2026-07 to 2026-09', '2026-02-30', '0000-01', null])('rejects missing/invalid month %j', (month) => expect(() => prepareImport(input([{ ...base, month }]))).toThrow(/month|date/));
    it('maps a real daily observation date into its explicit month', () => expect(prepareImport(input([{ ...base, month: '2024-02-29' }])).records[0].observations[0].month).toBe('2024-02'));
    it.each([-1, Infinity, NaN, '12M', '=100+5', '12,34', '100 apples', 1.5])('rejects invalid visits %j', (monthlyVisits) => expect(() => prepareImport(input([{ ...base, monthlyVisits }]))).toThrow(/monthlyVisits/));
    it('accepts grouped numbers and true zero without inventing missing values', () => {
        const result = prepareImport(input([{ ...base, monthlyVisits: '1,234', globalRank: null, pagesPerVisit: 'N/A', bounceRate: 0 }])).records[0].observations[0];
        expect(result.monthlyVisits).toBe(1234); expect(result.globalRank).toBeNull(); expect(result.pagesPerVisit).toBeNull(); expect(result.bounceRate).toBe(0);
    });
    it('treats bounceRate as percent, including values below one', () => expect(prepareImport(input([{ ...base, bounceRate: 0.5 }])).records[0].observations[0].bounceRate).toBe(0.5));
    it('converts only an explicitly labelled bounce fraction', () => {
        const { bounceRate: _removed, ...row } = base;
        expect(prepareImport(input([{ ...row, bounceRateFraction: 0.549 }])).records[0].observations[0].bounceRate).toBeCloseTo(54.9);
    });
    it('accepts percent text and explicit duration', () => {
        const result = prepareImport(input([{ ...base, bounceRate: '54.9%', avgVisitDuration: '00:02:30' }])).records[0].observations[0];
        expect(result.bounceRate).toBe(54.9); expect(result.avgVisitDuration).toBe(150);
    });
    it.each([{ bounceRate: 101 }, { globalRank: 0 }, { categoryRank: 1.5 }, { avgVisitDuration: '01:99:00' }, { country: 'United States' }, { trafficType: 'all' }, { measurementType: 'unknown-basis' }])('rejects invalid metric/context %j', (extra) => expect(() => prepareImport(input([{ ...base, ...extra }]))).toThrow());
});

describe('CSV parsing and report safety', () => {
    it('parses BOM, CRLF, quoted commas and escaped quotes', () => {
        const csv = '\uFEFFDomain,Month,Monthly Visits,Category\r\nexample.com,2026-09,"1,234","Tools ""A"", B"\r\n';
        const plan = prepareImport({ ...input(), importRecords: undefined, importCsv: csv });
        expect(plan.records[0].observations[0]).toMatchObject({ monthlyVisits: 1234, category: 'Tools "A", B' });
    });
    it('parses quoted newlines only in discarded columns', () => {
        const csv = 'domain,month,visits,notes\nexample.com,2026-09,10,"two\nlines"';
        expect(prepareImport({ ...input(), importRecords: undefined, importCsv: csv }).unsupportedColumnsDropped).toBe(1);
    });
    it.each(['domain,month,visits', 'domain,month,visits\nexample.com,2026-09', 'domain,month,visits\n"unclosed', 'domain,month,visits\n"example.com"x,2026-09,1', 'domain,month,visits\nexa"mple.com,2026-09,1', 'domain,month,visits,monthly_visits\nexample.com,2026-09,1,1', 'domain,,visits\nexample.com,2026-09,1', 'domain,month,visits\nexample.com,2026-09,1\0'])('rejects malformed CSV %j', (csv) => expect(() => parseCsv(csv)).toThrow());
    it('rejects oversized CSV', () => expect(() => parseCsv('x'.repeat(MAX_IMPORT_BYTES + 1))).toThrow(/2 MiB/));
    it('rejects more than 1,000 CSV observations', () => expect(() => parseCsv(`domain,month,visits\n${'example.com,2026-09,1\n'.repeat(1001)}`)).toThrow(/1,000/));
    it.each(['=WEBSERVICE("url")', '+SUM(A1)', '-cmd', '@SUM(1)', '  =1+1', '\tformula'])('neutralizes formula-like string %j', (value) => expect(csvCell(value)).toMatch(/^"'/));
    it('preserves safe negative numeric deltas', () => expect(csvCell(-10)).toBe('"-10"'));
    it('escapes CSV quotes', () => expect(csvCell('A "quoted" value')).toBe('"A ""quoted"" value"'));
    it('does not emit provider HTML or Markdown links', () => {
        const plan = prepareImport(input([base], { importSource: '<script>[click](https://example.org)</script>' }));
        const report = importMarkdown(plan.records);
        expect(report).not.toContain('<script>'); expect(report).not.toContain('[click](');
    });
    it('CSV includes provenance, period gaps and percentage-point semantics', () => {
        const csv = comparisonCsv(prepareImport(input()).records);
        expect(csv).toContain('"dataProvider"'); expect(csv).toContain('"periodGapMonths"'); expect(csv).toContain('"bounceRateChangePercentagePoints"');
    });
});

describe('honest comparisons', () => {
    it('sorts source months and computes adjacent-month changes', () => {
        const rows = comparisonRows(prepareImport(input([later, base])).records);
        expect(rows[1]).toMatchObject({ previousMonth: '2026-08', periodGapMonths: 1, isMonthOverMonth: true, visitsChange: 50, visitsChangePercent: 50, globalRankChange: -2, categoryRankChange: -1, bounceRateChangePercentagePoints: -5 });
    });
    it('does not call a multi-month gap MoM', () => expect(comparisonRows(prepareImport(input([base, { ...later, month: '2026-10' }])).records)[1]).toMatchObject({ periodGapMonths: 2, isMonthOverMonth: false }));
    it.each(['country', 'trafficType', 'measurementType'] as const)('disables comparisons when %s is missing', (field) => {
        const rows = comparisonRows(prepareImport(input([{ ...base, [field]: null }, { ...later, [field]: null }])).records);
        expect(rows[1]).toMatchObject({ comparisonStatus: 'context_missing', visitsChange: null, visitsChangePercent: null, includedDomainSharePercent: null });
    });
    it.each([{ country: 'gb' }, { trafficType: 'desktop' }, { measurementType: 'measured' }])('does not join changed scopes %j', (extra) => expect(comparisonRows(prepareImport(input([base, { ...later, ...extra }])).records)[1].visitsChange).toBeNull());
    it('does not compare category ranks across changed categories', () => expect(comparisonRows(prepareImport(input([base, { ...later, category: 'Other' }])).records)[1].categoryRankChange).toBeNull());
    it('never divides percentage growth by zero', () => expect(comparisonRows(prepareImport(input([{ ...base, monthlyVisits: 0 }, later])).records)[1]).toMatchObject({ visitsChange: 150, visitsChangePercent: null }));
    it('preserves unknown metric changes', () => expect(comparisonRows(prepareImport(input([{ ...base, monthlyVisits: null }, later])).records)[1].visitsChange).toBeNull());
    it('computes only included-domain share in a matched cohort', () => {
        const rows = comparisonRows(prepareImport(input([base, { ...base, domain: 'example.net', monthlyVisits: 300 }])).records);
        expect(rows[0].includedDomainSharePercent).toBe(25); expect(rows[1].includedDomainSharePercent).toBe(75);
        expect(rows[0].comparisonPeerCount).toBe(2);
    });
    it('has no share for one domain, different months or different scopes', () => {
        expect(comparisonRows(prepareImport(input([base])).records)[0].includedDomainSharePercent).toBeNull();
        expect(comparisonRows(prepareImport(input([base, { ...later, domain: 'example.net' }])).records).every((row) => row.includedDomainSharePercent === null)).toBe(true);
        expect(comparisonRows(prepareImport(input([base, { ...base, domain: 'example.net', country: 'gb' }])).records).every((row) => row.includedDomainSharePercent === null)).toBe(true);
    });
});

describe('offline save, spend and delivery workflow', () => {
    it('uses no upstream fetch and saves one result per domain, not per month', async () => {
        const fetch = vi.fn(() => { throw new Error('No external traffic permitted in fixture tests'); });
        vi.stubGlobal('fetch', fetch);
        const { ports, save, values } = fakePorts();
        const summary = await runImportWorkflow(input(), ports);
        expect(fetch).not.toHaveBeenCalled(); expect(save).toHaveBeenCalledTimes(1);
        expect(summary).toMatchObject({ savedDomainCount: 1, savedObservationCount: 2, upstreamRequestCount: 0, upstreamDataVerified: false, persistentHistoryWritten: false });
        expect(values.has('TRAFFIC_IMPORT_REPORT')).toBe(true); expect(values.has('TRAFFIC_COMPARISON.csv')).toBe(true); expect(values.has('TRAFFIC_REPORT.md')).toBe(true);
    });
    it('fails invalid input before saving or publishing output', async () => {
        const { ports, save } = fakePorts();
        await expect(runImportWorkflow(input([base, { ...base, monthlyVisits: 101 }]), ports)).rejects.toThrow(/conflicting/);
        expect(save).not.toHaveBeenCalled(); expect(ports.write).not.toHaveBeenCalled();
    });
    it('honors a zero remaining budget before the first result', async () => {
        const { ports, save, values } = fakePorts(); ports.canSave = () => false;
        const summary = await runImportWorkflow(input(), ports);
        expect(save).not.toHaveBeenCalled(); expect(summary).toMatchObject({ outcome: 'stopped_spending_limit', savedDomainCount: 0 });
        expect((values.get('TRAFFIC_IMPORT_REPORT') as { websites: unknown[] }).websites).toEqual([]);
    });
    it('stops after the last affordable saved website and excludes unpaid domains from reports', async () => {
        const { ports, save, values } = fakePorts();
        save.mockResolvedValueOnce({ chargedCount: 1, eventChargeLimitReached: true });
        const summary = await runImportWorkflow(input([base, { ...base, domain: 'example.net' }]), ports);
        expect(save).toHaveBeenCalledTimes(1); expect(summary).toMatchObject({ savedDomainCount: 1, outcome: 'stopped_spending_limit' });
        const report = values.get('TRAFFIC_IMPORT_REPORT') as { websites: unknown[]; comparisons: { includedDomainSharePercent: number | null }[] };
        expect(report.websites).toHaveLength(1); expect(report.comparisons[0].includedDomainSharePercent).toBeNull();
        expect(JSON.stringify(report)).not.toContain('example.net');
    });
    it('does not expose a denied, zero-charge row', async () => {
        const { ports, save, values } = fakePorts(); save.mockResolvedValueOnce({ chargedCount: 0, eventChargeLimitReached: true });
        const summary = await runImportWorkflow(input(), ports);
        expect(summary.savedDomainCount).toBe(0); expect((values.get('TRAFFIC_IMPORT_REPORT') as { websites: unknown[] }).websites).toEqual([]);
    });
    it('counts successfully saved free/pre-pricing results without inventing fees', async () => {
        const { ports, save } = fakePorts(); save.mockResolvedValueOnce({ chargedCount: 0, eventChargeLimitReached: false });
        expect((await runImportWorkflow(input(), ports)).savedDomainCount).toBe(1);
    });
    it('marks complete selected output successful even when its exact fee cap is reached', async () => {
        const { ports, save } = fakePorts(); save.mockResolvedValueOnce({ chargedCount: 1, eventChargeLimitReached: true });
        expect(await runImportWorkflow(input(), ports)).toMatchObject({ outcome: 'succeeded', spendingLimitReached: true, completeSelectedOutput: true, unsavedSelectedDomainCount: 0 });
    });
    it('validates agency options before the first billable result', async () => {
        const { ports, save } = fakePorts();
        await expect(runImportWorkflow(input([base], { visitChangeAlertPercent: 0 }), ports)).rejects.toThrow(/visitChangeAlertPercent/);
        expect(save).not.toHaveBeenCalled(); expect(ports.write).not.toHaveBeenCalled();
    });
    it('adds agency reports without adding billed events or exposing an unaffordable domain', async () => {
        const { ports, save, values } = fakePorts(); save.mockResolvedValueOnce({ chargedCount: 1, eventChargeLimitReached: true });
        await runImportWorkflow(input([base, later, { ...base, domain: 'example.net' }]), ports);
        expect(save).toHaveBeenCalledTimes(1);
        for (const key of ['TRAFFIC_AGENCY_REPORT', 'TRAFFIC_ALERTS.csv', 'TRAFFIC_QUALITY.csv']) {
            expect(values.has(key)).toBe(true); expect(JSON.stringify(values.get(key))).not.toContain('example.net');
        }
    });
    it('stops on dataset failure and does not reveal exception secrets', async () => {
        const { ports, save, values } = fakePorts(); save.mockRejectedValueOnce(new Error('secret-token'));
        await expect(runImportWorkflow(input([base, { ...base, domain: 'example.net' }]), ports)).rejects.toThrow(/dataset delivery failed/);
        expect(save).toHaveBeenCalledTimes(1); expect(JSON.stringify([...values])).not.toContain('secret-token');
        expect(values.get('RUN_STATUS')).toMatchObject({ outcome: 'failed_delivery', savedDomainCount: 0 });
    });
    it('stops safely when the budget checker fails', async () => {
        const { ports, save, values } = fakePorts();
        ports.canSave = () => { throw new Error('private-billing-token'); };
        await expect(runImportWorkflow(input(), ports)).rejects.toThrow(/dataset delivery failed/);
        expect(save).not.toHaveBeenCalled();
        expect(values.get('RUN_STATUS')).toMatchObject({ outcome: 'failed_delivery', savedDomainCount: 0 });
        expect(JSON.stringify([...values])).not.toContain('private-billing-token');
    });
    it('marks report-write failure honestly without continuing dataset writes', async () => {
        const { ports, save, values } = fakePorts();
        ports.write = vi.fn(async (key, value) => { if (key.endsWith('.csv')) throw new Error('secret-url'); values.set(key, value); });
        await expect(runImportWorkflow(input(), ports)).rejects.toThrow(/report delivery failed/);
        expect(save).toHaveBeenCalledTimes(1); expect(values.get('RUN_STATUS')).toMatchObject({ reportsComplete: false, outcome: 'failed_delivery' });
        expect(JSON.stringify([...values])).not.toContain('secret-url');
    });
});
