import { comparisonCsv, comparisonRows, csvCell, ImportInputError, prepareImport, selectMode } from './importer.js';
import { agencyAlertsCsv, agencyMarkdown, agencyOptions, agencyQualityCsv, buildAgencyReport } from './agency-report.js';
import { demoPreset } from './demo-presets.js';

export interface DemoPorts {
    write(key: string, value: unknown, contentType?: string): Promise<void>;
    status(message: string): Promise<void>;
}

/** Fixed, developer-authored synthetic examples. Never saved as dataset results. */
export async function runDemoWorkflow(input: unknown, ports: DemoPorts, now = new Date()): Promise<Record<string, unknown>> {
    if (selectMode(input) !== 'demo') throw new ImportInputError('Select mode: demo explicitly to preview synthetic reports.');
    const preset = demoPreset(input);
    const options = agencyOptions(input);
    const plan = prepareImport({
        mode: 'import', authorizedData: true,
        importSource: 'SYNTHETIC DEMO - not Similarweb measurements', maxResults: 2,
        importRecords: preset.rows,
    }, now);
    const agencyReport = buildAgencyReport(plan.records, options, { source: 'synthetic-demo', isSynthetic: true });
    const previewRows = comparisonRows(plan.records).map((row) => ({
        ...row, recordSource: 'synthetic-demo' as const, isSynthetic: true,
    }));
    const summary = {
        mode: 'demo', outcome: 'demo_complete', source: 'synthetic-demo', isSynthetic: true,
        demoPreset: preset.name,
        previewDomainCount: plan.records.length, previewObservationCount: plan.normalizedObservationCount,
        savedDomainCount: 0, savedObservationCount: 0, websiteResultEventCount: 0,
        upstreamRequestCount: 0, upstreamDataVerified: false, persistentHistoryWritten: false,
        reportsComplete: true,
        chargeNotice: 'No website-result event. Actor Start and applicable platform usage can still apply.',
        nextStep: 'For real analysis, select import, provide your authorized CSV/JSON export and provider label, and explicitly confirm authorizedData. Do not use this demo as source data.',
    };
    const rawCsv = comparisonCsv(plan.records).split('\r\n');
    const demoCsv = rawCsv.map((line, index) => `${index === 0
        ? [csvCell('recordSource'), csvCell('isSynthetic')].join(',')
        : [csvCell('synthetic-demo'), csvCell(true)].join(',')},${line}`).join('\r\n');
    const markdown = [
        '# Synthetic traffic report preview', '',
        '**DEMO ONLY — invented example values, not live Similarweb data or customer observations.**', '',
        'Dataset results saved: 0. Website-result events: 0. Actor Start and applicable platform usage can still apply.',
        'No source lookup, API call, proxy request or persistent history write is performed.', '',
        '| Synthetic domain | Month | Visits | Visits change % | Bounce change (percentage points) | Included-domain share % |',
        '| --- | --- | ---: | ---: | ---: | ---: |',
        ...previewRows.map((row) => `| ${row.domain} | ${row.month} | ${row.monthlyVisits ?? 'unknown'} | ${row.visitsChangePercent ?? 'unknown'} | ${row.bounceRateChangePercentagePoints ?? 'unknown'} | ${row.includedDomainSharePercent ?? 'unknown'} |`),
        '',
        'Shares cover only this synthetic comparison set, not market shares. These example months are not current data.',
        'Real comparisons require matching provider, country, traffic type and estimated/measured basis. Unknowns remain unknown; month gaps are explicit.', '',
        '## Analyze your own export', '',
        'Select import, identify your export provider, paste authorized CSV/JSON data and confirm the required processing rights. Real saved domain analyses trigger the normal website-result event. Demo does not validate live API access, customer reliability or profitability.',
    ].join('\n');
    try {
        await ports.write('DEMO_REPORT', {
            summary,
            previewWebsites: plan.records.map((record) => ({
                ...record, recordType: 'synthetic-traffic-preview', source: 'synthetic-demo', isSynthetic: true,
            })),
            previewComparisons: previewRows,
        });
        await ports.write('DEMO_AGENCY_REPORT', agencyReport);
        await ports.write('DEMO_ALERTS.csv', agencyAlertsCsv(agencyReport), 'text/csv; charset=utf-8');
        await ports.write('DEMO_QUALITY.csv', agencyQualityCsv(agencyReport), 'text/csv; charset=utf-8');
        await ports.write('DEMO_COMPARISON.csv', demoCsv, 'text/csv; charset=utf-8');
        await ports.write('DEMO_REPORT.md', `${markdown}\n\n${agencyMarkdown(agencyReport)}`, 'text/markdown; charset=utf-8');
        await ports.write('RUN_STATUS', summary);
        await ports.status('Demo complete: synthetic report preview only; 0 dataset results, 0 website-result events. Actor Start and applicable usage may apply.');
    } catch {
        await ports.write('RUN_STATUS', { ...summary, outcome: 'failed_delivery', reportsComplete: false }).catch(() => undefined);
        throw new Error('Synthetic demo report delivery failed. No website-result events or dataset results were created.');
    }
    return summary;
}
