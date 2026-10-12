import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDemoWorkflow } from './demo-workflow.js';
import { parseCsv, prepareImport, selectMode } from './importer.js';
import type { DemoPorts } from './demo-workflow.js';
import type { AgencyReport } from './agency-report.js';

function fakePorts() {
    const values = new Map<string, unknown>();
    const save = vi.fn(() => { throw new Error('Demo cannot save or charge results.'); });
    const canSave = vi.fn(() => { throw new Error('Demo cannot consult the result budget.'); });
    const ports = {
        write: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
        status: vi.fn(async (_message: string) => undefined),
        save, canSave,
    };
    return { values, ports, save, canSave };
}

afterEach(() => vi.unstubAllGlobals());

describe('explicit, no-result-billing synthetic demo', () => {
    it('selects the explicit demo without requiring a key or rights checkbox', () => expect(selectMode({ mode: 'demo' })).toBe('demo'));
    it('retains legacy API routing', () => expect(selectMode({ apiKey: 'private-key', domains: ['example.com'] })).toBe('official-api'));
    it('does not turn empty or invalid import input into a successful demo', () => {
        expect(selectMode({})).toBe('import');
        expect(() => prepareImport({ mode: 'import' })).toThrow();
    });
    it.each([
        { mode: 'demo', apiKey: 'private-key' },
        { mode: 'demo', importRecords: [] },
        { mode: 'demo', importRecords: [{ domain: 'example.com' }] },
        { mode: 'demo', importCsv: 'domain,month,visits\nexample.com,2026-09,1' },
        { mode: 'demo', importCsv: 10 },
        { mode: 'demo', apiKey: {} },
    ])('rejects real data or credentials in demo %j', (input) => expect(() => selectMode(input)).toThrow(/Demo accepts no/));
    it('accepts harmless empty UI fields without overriding API tasks', () => expect(selectMode({ mode: 'demo', importCsv: '', apiKey: '', authorizedData: false })).toBe('demo'));
    it('writes previews without dataset saves, budget checks or upstream fetch', async () => {
        const fetch = vi.fn(() => { throw new Error('No networking in demo tests.'); });
        vi.stubGlobal('fetch', fetch);
        const { ports, values, save, canSave } = fakePorts();
        const summary = await runDemoWorkflow({ mode: 'demo' }, ports, new Date('2026-10-12T00:00:00Z'));
        expect(summary).toMatchObject({ mode: 'demo', outcome: 'demo_complete', source: 'synthetic-demo', isSynthetic: true, savedDomainCount: 0, savedObservationCount: 0, websiteResultEventCount: 0, upstreamRequestCount: 0, persistentHistoryWritten: false });
        expect(save).not.toHaveBeenCalled(); expect(canSave).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
        expect([...values.keys()]).toEqual(['DEMO_REPORT', 'DEMO_AGENCY_REPORT', 'DEMO_ALERTS.csv', 'DEMO_QUALITY.csv', 'DEMO_COMPARISON.csv', 'DEMO_REPORT.md', 'RUN_STATUS']);
        expect(JSON.stringify(values.get('DEMO_REPORT'))).not.toContain('user-authorized-import');
        expect(JSON.stringify(values.get('DEMO_REPORT'))).toContain('SYNTHETIC DEMO');
    });
    it('labels every preview row as synthetic and keeps example calculations correct', async () => {
        const { ports, values } = fakePorts();
        await runDemoWorkflow({ mode: 'demo' }, ports);
        const rows = parseCsv(values.get('DEMO_COMPARISON.csv') as string);
        expect(rows).toHaveLength(3);
        expect(rows.every((row) => row.isSynthetic === 'true' && row.recordSource === 'synthetic-demo')).toBe(true);
        const current = rows.find((row) => row.domain === 'example.com' && row.month === '2026-09')!;
        expect(current.visitsChangePercent).toBe('20');
        expect(current.bounceRateChangePercentagePoints).toBe('-4.9');
        expect(current.includedDomainSharePercent).toBe('40');
        const markdown = values.get('DEMO_REPORT.md') as string;
        expect(markdown).toContain('DEMO ONLY'); expect(markdown).toContain('Website-result events: 0');
        expect(markdown).toContain('not market shares'); expect(markdown).toContain('Actor Start');
    });
    it('discloses possible start/usage costs rather than calling the run free', async () => {
        const { ports } = fakePorts();
        const summary = await runDemoWorkflow({ mode: 'demo' }, ports);
        expect(summary.chargeNotice).toContain('Actor Start and applicable platform usage');
        expect(String(summary.chargeNotice)).not.toMatch(/free run|all costs waived/i);
    });
    it('fails visibly when report delivery fails, without creating billable results', async () => {
        const { ports, values, save } = fakePorts();
        ports.write.mockImplementation(async (key, value) => {
            if (key.endsWith('.csv')) throw new Error('secret-store-url');
            values.set(key, value);
        });
        await expect(runDemoWorkflow({ mode: 'demo' }, ports)).rejects.toThrow(/demo report delivery failed/);
        expect(values.get('RUN_STATUS')).toMatchObject({ mode: 'demo', outcome: 'failed_delivery', reportsComplete: false, websiteResultEventCount: 0 });
        expect(save).not.toHaveBeenCalled(); expect(JSON.stringify([...values])).not.toContain('secret-store-url');
    });
    it('does not accept import mode through the demo runner', async () => {
        const { ports } = fakePorts();
        await expect(runDemoWorkflow({ mode: 'import' }, ports)).rejects.toThrow(/explicitly/);
        expect(ports.write).not.toHaveBeenCalled();
    });
    it('requires no save or charging function in the demo interface', async () => {
        const values = new Map<string, unknown>();
        const ports: DemoPorts = { write: async (key, value) => { values.set(key, value); }, status: async () => undefined };
        await expect(runDemoWorkflow({ mode: 'demo' }, ports)).resolves.toMatchObject({ websiteResultEventCount: 0 });
    });
    it.each(['us-agency-comparison', 'us-traffic-change-alerts', 'us-scope-audit'])('runs the explicit %s preview without result billing', async (demoPreset) => {
        const { ports, values, save, canSave } = fakePorts();
        expect(await runDemoWorkflow({ mode: 'demo', demoPreset }, ports)).toMatchObject({ demoPreset, websiteResultEventCount: 0, savedDomainCount: 0 });
        expect(save).not.toHaveBeenCalled(); expect(canSave).not.toHaveBeenCalled();
        const report = values.get('DEMO_AGENCY_REPORT') as AgencyReport;
        expect(report.source).toBe('synthetic-demo'); expect(report.isSynthetic).toBe(true);
        expect(report.quality.every((row) => row.isSynthetic)).toBe(true);
    });
    it('previews the three distinct threshold findings', async () => {
        const { ports, values } = fakePorts();
        await runDemoWorkflow({ mode: 'demo', demoPreset: 'us-traffic-change-alerts' }, ports);
        expect((values.get('DEMO_AGENCY_REPORT') as AgencyReport).alerts.map((row) => row.rule)).toEqual(['visits_drop', 'bounce_rate_increase', 'global_rank_worsening']);
    });
    it('demonstrates unknown/world scope and gaps without false monthly alerts', async () => {
        const { ports, values } = fakePorts();
        await runDemoWorkflow({ mode: 'demo', demoPreset: 'us-scope-audit' }, ports);
        expect((values.get('DEMO_AGENCY_REPORT') as AgencyReport).summary).toMatchObject({ periodGapCount: 1, differentCountryObservationCount: 1, unknownCountryObservationCount: 1, alertCount: 0 });
    });
    it('rejects an unknown preset before any output', async () => {
        const { ports } = fakePorts();
        await expect(runDemoWorkflow({ mode: 'demo', demoPreset: 'bad' }, ports)).rejects.toThrow(/demoPreset/);
        expect(ports.write).not.toHaveBeenCalled();
    });
});
