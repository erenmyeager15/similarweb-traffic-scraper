import { comparisonCsv, comparisonRows, importMarkdown, prepareImport } from './importer.js';
import type { ImportDomainRecord, ImportPlan } from './importer.js';
import type { ChargeResultLike } from './types.js';
import { agencyAlertsCsv, agencyMarkdown, agencyOptions, agencyQualityCsv, buildAgencyReport } from './agency-report.js';

export interface ImportPorts {
    canSave(): boolean;
    save(record: ImportDomainRecord): Promise<ChargeResultLike>;
    write(key: string, value: unknown, contentType?: string): Promise<void>;
    status(message: string): Promise<void>;
}

export class ImportDeliveryError extends Error {
    readonly code = 'IMPORT_DELIVERY_FAILED';
}

export async function runImportWorkflow(input: unknown, ports: ImportPorts, now = new Date()): Promise<Record<string, unknown>> {
    // Validate the complete supplied export before any billable result write.
    const plan: ImportPlan = prepareImport(input, now);
    const options = agencyOptions(input);
    const saved: ImportDomainRecord[] = [];
    let stoppedAtSpendingLimit = false;
    let saveFailed = false;
    for (const record of plan.records) {
        try {
            if (!ports.canSave()) { stoppedAtSpendingLimit = true; break; }
            const result = await ports.save(record);
            const limited = result.eventChargeLimitReached === true;
            if (result.chargedCount > 0 || !limited) saved.push(record);
            if (limited) { stoppedAtSpendingLimit = true; break; }
        } catch {
            saveFailed = true;
            break;
        }
    }
    const summary = {
        mode: 'import', source: 'user-authorized-import', dataProvider: plan.dataProvider,
        outcome: saveFailed ? 'failed_delivery' : saved.length < plan.selectedDomainCount && stoppedAtSpendingLimit ? 'stopped_spending_limit' : 'succeeded',
        spendingLimitReached: stoppedAtSpendingLimit,
        completeSelectedOutput: !saveFailed && saved.length === plan.selectedDomainCount,
        unsavedSelectedDomainCount: plan.selectedDomainCount - saved.length,
        inputRowCount: plan.inputRowCount, normalizedObservationCount: plan.normalizedObservationCount,
        duplicateObservationsRemoved: plan.duplicateObservationsRemoved,
        inputDomainCount: plan.inputDomainCount, selectedDomainCount: plan.selectedDomainCount,
        savedDomainCount: saved.length, savedObservationCount: saved.reduce((sum, item) => sum + item.observationCount, 0),
        omittedDomainCount: plan.omittedDomainCount, unsupportedColumnsDropped: plan.unsupportedColumnsDropped,
        upstreamRequestCount: 0, upstreamDataVerified: false, persistentHistoryWritten: false,
        reportsComplete: !saveFailed,
    };
    const agencyReport = buildAgencyReport(saved, options);
    try {
        // Never export unpaid/unsaved domains. No persistent history is modified.
        await ports.write('TRAFFIC_IMPORT_REPORT', { summary, websites: saved, comparisons: comparisonRows(saved) });
        await ports.write('TRAFFIC_COMPARISON.csv', comparisonCsv(saved), 'text/csv; charset=utf-8');
        await ports.write('TRAFFIC_REPORT.md', `${importMarkdown(saved)}\n\n${agencyMarkdown(agencyReport)}`, 'text/markdown; charset=utf-8');
        await ports.write('TRAFFIC_AGENCY_REPORT', agencyReport);
        await ports.write('TRAFFIC_ALERTS.csv', agencyAlertsCsv(agencyReport), 'text/csv; charset=utf-8');
        await ports.write('TRAFFIC_QUALITY.csv', agencyQualityCsv(agencyReport), 'text/csv; charset=utf-8');
        await ports.write('RUN_STATUS', summary);
    } catch {
        await ports.write('RUN_STATUS', { ...summary, outcome: 'failed_delivery', reportsComplete: false }).catch(() => undefined);
        throw new ImportDeliveryError('Import report delivery failed. Already saved website analyses retain their normal result charges; no further websites were processed.');
    }
    if (saveFailed) throw new ImportDeliveryError('Import dataset delivery failed. Previously saved website analyses retain their normal result charges; no further websites were processed.');
    await ports.status(`Import ${summary.outcome}: saved ${saved.length} website analysis(es), ${summary.savedObservationCount} supplied observations; no upstream requests.`);
    return summary;
}
