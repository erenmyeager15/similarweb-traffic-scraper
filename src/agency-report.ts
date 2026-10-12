import { comparisonRows, csvCell, ImportInputError } from './importer.js';
import type { ComparisonRow, ImportDomainRecord } from './importer.js';

export interface AgencyOptions {
    focusCountry: string;
    visitChangeAlertPercent: number;
    bounceIncreaseAlertPoints: number;
    rankWorseningAlertPercent: number;
}

export function agencyOptions(input: unknown): AgencyOptions {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ImportInputError('Agency report options require an input object.');
    const value = input as Record<string, unknown>;
    const focus = value.reportFocusCountry ?? 'us';
    if (typeof focus !== 'string' || !/^(?:world|[a-z]{2})$/i.test(focus.trim())) {
        throw new ImportInputError('reportFocusCountry must be world or a two-letter country scope. It never rewrites imported country labels.');
    }
    const threshold = (name: string, fallback: number, maximum: number): number => {
        const result = value[name] ?? fallback;
        if (typeof result !== 'number' || !Number.isFinite(result) || result < 0.1 || result > maximum) {
            throw new ImportInputError(`${name} must be a number between 0.1 and ${maximum}.`);
        }
        return result;
    };
    return {
        focusCountry: focus.trim().toLowerCase(),
        visitChangeAlertPercent: threshold('visitChangeAlertPercent', 20, 1000),
        bounceIncreaseAlertPoints: threshold('bounceIncreaseAlertPoints', 5, 100),
        rankWorseningAlertPercent: threshold('rankWorseningAlertPercent', 20, 1000),
    };
}

const metricFields = ['monthlyVisits', 'globalRank', 'categoryRank', 'pagesPerVisit', 'avgVisitDuration', 'bounceRate'] as const;
const scopeId = (row: ComparisonRow): string => JSON.stringify([row.domain, row.dataProvider, row.country, row.trafficType, row.measurementType]);
const rounded = (value: number): number => Number(value.toFixed(6));

/** Deterministic review signals, not predictions, source validation or causal findings. */
export function buildAgencyReport(records: ImportDomainRecord[], options: AgencyOptions,
    provenance: { source: 'user-authorized-import' | 'synthetic-demo'; isSynthetic: boolean } = { source: 'user-authorized-import', isSynthetic: false }) {
    const rows = comparisonRows(records);
    const observationsByScopeMonth = new Map(rows.map((row) => [`${scopeId(row)}:${row.month}`, row]));
    const latestMonths = new Map<string, string>();
    for (const row of rows) {
        const key = scopeId(row);
        if (row.month > (latestMonths.get(key) ?? '')) latestMonths.set(key, row.month);
    }
    const quality = rows.map((row) => {
        const missingMetrics = metricFields.filter((field) => row[field] === null);
        const missingContext = (['country', 'trafficType', 'measurementType'] as const).filter((field) => row[field] === null);
        return {
            ...provenance, domain: row.domain, month: row.month, dataProvider: row.dataProvider,
            country: row.country, trafficType: row.trafficType, measurementType: row.measurementType,
            focusCountryStatus: row.country === null ? 'unknown' : row.country === options.focusCountry ? 'matches' : 'different_scope',
            missingMetrics, missingContext, metricCount: metricFields.length - missingMetrics.length,
            qualityStatus: missingContext.length ? 'context_missing' : missingMetrics.length ? 'partial_metrics' : 'complete_fields',
            previousMonth: row.previousMonth, periodGapMonths: row.periodGapMonths,
            isLatestSuppliedInScope: latestMonths.get(scopeId(row)) === row.month,
            comparisonPeerCount: row.comparisonPeerCount,
            hasMatchedVisitPeers: row.comparisonPeerCount >= 2,
            hasComparableAdjacentMonth: row.isMonthOverMonth,
        };
    });
    const alerts: Array<{
        source: string; isSynthetic: boolean; domain: string; month: string; previousMonth: string;
        dataProvider: string; country: string | null; trafficType: string | null; measurementType: string | null;
        focusCountryStatus: string; rule: string; metric: string; change: number; unit: string; threshold: number;
        currentValue: number; previousValue: number; requiresReview: true;
    }> = [];
    for (const row of rows) {
        // Never treat a gap, missing scope or first observation as a monthly alert.
        if (!row.isMonthOverMonth || !row.previousMonth || row.comparisonStatus !== 'comparable') continue;
        const previous = observationsByScopeMonth.get(`${scopeId(row)}:${row.previousMonth}`);
        if (!previous) continue;
        const add = (rule: string, metric: string, change: number, unit: string, threshold: number, currentValue: number, previousValue: number): void => {
            alerts.push({ ...provenance, domain: row.domain, month: row.month, previousMonth: row.previousMonth!,
                dataProvider: row.dataProvider, country: row.country, trafficType: row.trafficType, measurementType: row.measurementType,
                focusCountryStatus: row.country === options.focusCountry ? 'matches' : 'different_scope',
                rule, metric, change, unit, threshold, currentValue, previousValue, requiresReview: true });
        };
        if (row.monthlyVisits !== null && previous.monthlyVisits !== null && previous.monthlyVisits > 0) {
            const change = (row.monthlyVisits - previous.monthlyVisits) / previous.monthlyVisits * 100;
            if (Math.abs(change) >= options.visitChangeAlertPercent) add(change < 0 ? 'visits_drop' : 'visits_growth', 'monthlyVisits', rounded(change),
                'percent', options.visitChangeAlertPercent, row.monthlyVisits, previous.monthlyVisits);
        }
        if (row.bounceRate !== null && previous.bounceRate !== null) {
            const change = row.bounceRate - previous.bounceRate;
            if (change >= options.bounceIncreaseAlertPoints) add('bounce_rate_increase', 'bounceRate', rounded(change), 'percentage_points',
                options.bounceIncreaseAlertPoints, row.bounceRate, previous.bounceRate);
        }
        if (row.globalRank !== null && previous.globalRank !== null && previous.globalRank > 0) {
            const change = (row.globalRank - previous.globalRank) / previous.globalRank * 100;
            if (change >= options.rankWorseningAlertPercent) {
                add('global_rank_worsening', 'globalRank', rounded(change), 'percent', options.rankWorseningAlertPercent, row.globalRank, previous.globalRank);
            }
        }
    }
    const latestQuality = quality.filter((row) => row.isLatestSuppliedInScope);
    return {
        ...provenance, options,
        summary: {
            savedDomainCount: records.length, observationCount: rows.length, alertCount: alerts.length,
            focusCountryObservationCount: quality.filter((row) => row.focusCountryStatus === 'matches').length,
            differentCountryObservationCount: quality.filter((row) => row.focusCountryStatus === 'different_scope').length,
            unknownCountryObservationCount: quality.filter((row) => row.focusCountryStatus === 'unknown').length,
            contextMissingObservationCount: quality.filter((row) => row.missingContext.length > 0).length,
            partialMetricObservationCount: quality.filter((row) => row.missingMetrics.length > 0).length,
            periodGapCount: quality.filter((row) => row.periodGapMonths !== null && row.periodGapMonths > 1).length,
            latestSuppliedScopeCount: latestQuality.length,
            latestScopesWithoutMatchedVisitPeers: latestQuality.filter((row) => !row.hasMatchedVisitPeers).length,
            upstreamDataVerified: false, persistentHistoryWritten: false,
        },
        notices: [
            'Only confirmed saved domains are analyzed; shares are included-domain shares, not market shares.',
            'Threshold signals use supplied adjacent months with matching provider, country, traffic type and measurement basis.',
            'Country scope and provider labels are user supplied, not independently verified; focusCountry never changes the data.',
            'Complete fields does not mean accurate or licensed source data. Latest means latest supplied, not fresh or current.',
            'Review signals are not predictions, causal explanations, automated notifications or a scheduled monitor.',
        ],
        alerts, quality,
    };
}

export type AgencyReport = ReturnType<typeof buildAgencyReport>;

export function agencyAlertsCsv(report: AgencyReport): string {
    const fields = ['source', 'isSynthetic', 'domain', 'month', 'previousMonth', 'dataProvider', 'country', 'trafficType',
        'measurementType', 'focusCountryStatus', 'rule', 'metric', 'change', 'unit', 'threshold', 'currentValue', 'previousValue', 'requiresReview'] as const;
    return [fields.map(csvCell).join(','), ...report.alerts.map((row) => fields.map((field) => csvCell(row[field])).join(','))].join('\r\n');
}

export function agencyQualityCsv(report: AgencyReport): string {
    const fields = ['source', 'isSynthetic', 'domain', 'month', 'dataProvider', 'country', 'trafficType', 'measurementType',
        'focusCountryStatus', 'qualityStatus', 'metricCount', 'missingMetrics', 'missingContext', 'previousMonth', 'periodGapMonths',
        'isLatestSuppliedInScope', 'comparisonPeerCount', 'hasMatchedVisitPeers', 'hasComparableAdjacentMonth'] as const;
    return [fields.map(csvCell).join(','), ...report.quality.map((row) => fields.map((field) => csvCell(
        Array.isArray(row[field]) ? row[field].join(';') : row[field])).join(','))].join('\r\n');
}

export function agencyMarkdown(report: AgencyReport): string {
    return ['## Agency review checklist', '',
        `Focus country: ${report.options.focusCountry}; matching supplied observations: ${report.summary.focusCountryObservationCount}; different scope: ${report.summary.differentCountryObservationCount}; unknown country: ${report.summary.unknownCountryObservationCount}.`,
        `Review signals: ${report.summary.alertCount}; missing comparison context: ${report.summary.contextMissingObservationCount}; period gaps: ${report.summary.periodGapCount}.`,
        `Latest supplied scopes without matching visit peers: ${report.summary.latestScopesWithoutMatchedVisitPeers}. This is coverage, not market completeness.`, '',
        'Alerts only compare adjacent supplied months. Visit/rank changes use percent; bounce changes use percentage points. Country labels are not proof of a US audience.',
        'Download the agency JSON plus separate alerts and data-quality CSVs for the exact evidence. No automatic notification, schedule or causal inference.', '',
        '| Domain | Month | Rule | Change | Unit | Threshold |', '| --- | --- | --- | ---: | --- | ---: |',
        ...report.alerts.map((row) => `| ${row.domain} | ${row.month} | ${row.rule} | ${row.change} | ${row.unit} | ${row.threshold} |`), '',
    ].join('\n');
}
