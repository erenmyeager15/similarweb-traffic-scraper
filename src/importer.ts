import { Buffer } from 'node:buffer';
import { domainToASCII } from 'node:url';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1000;
const METRICS = ['globalRank', 'categoryRank', 'monthlyVisits', 'pagesPerVisit', 'avgVisitDuration', 'bounceRate'] as const;
type Metric = typeof METRICS[number];
type RawRow = Record<string, unknown>;
export type TrafficType = 'all-traffic' | 'desktop' | 'mobile-web';
export type MeasurementType = 'estimated' | 'measured';

export class ImportInputError extends Error {
    readonly code = 'INVALID_IMPORT';
}

export interface Observation {
    domain: string;
    month: string;
    country: string | null;
    trafficType: TrafficType | null;
    measurementType: MeasurementType | null;
    dataProvider: string;
    category: string | null;
    globalRank: number | null;
    categoryRank: number | null;
    monthlyVisits: number | null;
    pagesPerVisit: number | null;
    avgVisitDuration: number | null;
    bounceRate: number | null;
}

export interface Trend {
    current: Observation;
    previousMonth: string | null;
    periodGapMonths: number | null;
    isMonthOverMonth: boolean;
    comparisonStatus: 'first_observation' | 'comparable' | 'context_missing';
    visitsChange: number | null;
    visitsChangePercent: number | null;
    globalRankChange: number | null;
    categoryRankChange: number | null;
    pagesPerVisitChange: number | null;
    avgVisitDurationChangeSeconds: number | null;
    bounceRateChangePercentagePoints: number | null;
}

export interface ImportDomainRecord {
    recordType: 'authorized-traffic-import';
    domain: string;
    source: 'user-authorized-import';
    dataProvider: string;
    importedAt: string;
    observationCount: number;
    incompleteContextCount: number;
    observations: Observation[];
    trends: Trend[];
}

export interface ImportPlan {
    records: ImportDomainRecord[];
    inputRowCount: number;
    normalizedObservationCount: number;
    duplicateObservationsRemoved: number;
    inputDomainCount: number;
    selectedDomainCount: number;
    omittedDomainCount: number;
    unsupportedColumnsDropped: number;
    dataProvider: string;
}

const ALIASES: Record<string, string> = {
    domain: 'domain', website: 'domain', site: 'domain', url: 'domain',
    month: 'month', date: 'month', period: 'month',
    country: 'country', countryscope: 'country',
    traffictype: 'trafficType', trafficscope: 'trafficType', device: 'trafficType',
    measurementtype: 'measurementType', measurementbasis: 'measurementType',
    globalrank: 'globalRank', categoryrank: 'categoryRank', category: 'category',
    monthlyvisits: 'monthlyVisits', visits: 'monthlyVisits',
    pagespervisit: 'pagesPerVisit', averagepagespervisit: 'pagesPerVisit',
    avgvisitduration: 'avgVisitDuration', averagevisitduration: 'avgVisitDuration',
    avgvisitdurationseconds: 'avgVisitDuration',
    bouncerate: 'bounceRate', bounceratepercent: 'bounceRate',
    bounceratefraction: 'bounceRateFraction',
};

function fail(row: number, message: string): never {
    throw new ImportInputError(`Import row ${row}: ${message}`);
}

function headerKey(header: string): string {
    return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function aliasField(header: string): string | undefined {
    const key = headerKey(header);
    return Object.hasOwn(ALIASES, key) ? ALIASES[key] : undefined;
}

/** Bounded RFC-4180-style CSV. No URLs, spreadsheets, formulas or ZIP files are opened. */
export function parseCsv(text: string): RawRow[] {
    if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) throw new ImportInputError('CSV exceeds the 2 MiB input limit.');
    if (text.includes('\0')) throw new ImportInputError('CSV contains an unsupported null character.');
    text = text.replace(/^\uFEFF/, '');
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    let closed = false;
    const pushRow = (): void => {
        row.push(cell);
        if (row.some((value) => value.trim() !== '')) rows.push(row);
        if (rows.length > MAX_IMPORT_ROWS + 1) throw new ImportInputError('CSV exceeds the 1,000 observation limit.');
        row = []; cell = ''; closed = false;
    };
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
            else if (char === '"') { quoted = false; closed = true; }
            else cell += char;
        } else if (char === ',') {
            row.push(cell); cell = ''; closed = false;
        } else if (char === '\r' || char === '\n') {
            if (char === '\r' && text[i + 1] === '\n') i += 1;
            pushRow();
        } else if (char === '"') {
            if (cell !== '' || closed) throw new ImportInputError('CSV contains a misplaced quote.');
            quoted = true;
        } else if (closed) {
            if (char !== ' ' && char !== '\t') throw new ImportInputError('CSV contains text after a closing quote.');
        } else cell += char;
    }
    if (quoted) throw new ImportInputError('CSV contains an unclosed quoted field.');
    if (cell !== '' || row.length > 0 || closed) pushRow();
    if (rows.length < 2) throw new ImportInputError('CSV needs a header and at least one observation.');
    const headers = rows.shift()!;
    if (headers.length > 50 || headers.some((header) => !header.trim() || header.length > 100)) {
        throw new ImportInputError('CSV headers must be nonempty; maximum 50 columns and 100 characters per header.');
    }
    const normalized = headers.map((header) => aliasField(header) ?? headerKey(header));
    if (new Set(normalized).size !== normalized.length) throw new ImportInputError('CSV contains duplicate or ambiguous headers.');
    return rows.map((values, index) => {
        if (values.length !== headers.length) fail(index + 1, 'column count does not match the header.');
        return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
    });
}

function canonicalRow(raw: unknown, row: number, dropped: Set<string>): RawRow {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(row, 'expected an object.');
    const canonical: RawRow = Object.create(null) as RawRow;
    for (const [key, value] of Object.entries(raw)) {
        const field = aliasField(key);
        if (!field) { dropped.add(headerKey(key)); continue; }
        if (Object.hasOwn(canonical, field)) fail(row, 'multiple columns map to the same field.');
        canonical[field] = value;
    }
    if (Object.hasOwn(canonical, 'bounceRate') && Object.hasOwn(canonical, 'bounceRateFraction')) {
        fail(row, 'provide bounceRate in percent OR bounceRateFraction, not both.');
    }
    return canonical;
}

function missing(value: unknown): boolean {
    return value === undefined || value === null || (typeof value === 'string' && /^(?:\s*|n\/?a|null|--?|unknown)$/i.test(value.trim()));
}

export function normalizeImportDomain(value: unknown, row = 1): string {
    if (typeof value !== 'string' || value.length > 1000) fail(row, 'domain must be a valid public website name.');
    const text = value.trim();
    let url: URL;
    try { url = new URL(text.includes('://') ? text : `https://${text}`); }
    catch { fail(row, 'domain must be a valid public website name.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
        fail(row, 'domain URLs cannot contain credentials, custom ports or non-HTTP schemes.');
    }
    const domain = domainToASCII(url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''));
    const labels = domain.split('.');
    if (domain.length > 253 || labels.length < 2 || !/^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(labels.at(-1)!)
        || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
        fail(row, 'domain must be a valid public website name.');
    }
    return domain;
}

function monthValue(value: unknown, row: number): string {
    if (typeof value !== 'string') fail(row, 'month is required as YYYY-MM; date ranges and totals are not monthly observations.');
    const match = value.trim().match(/^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/);
    if (!match || Number(match[1]) < 1900 || Number(match[1]) > 9999) fail(row, 'month must be YYYY-MM or a valid YYYY-MM-DD date.');
    if (match[3]) {
        const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
        if (day.getUTCDate() !== Number(match[3])) fail(row, 'date is not a real calendar date.');
    }
    return `${match[1]}-${match[2]}`;
}

function numeric(value: unknown, row: number, field: string, max = Number.MAX_SAFE_INTEGER, integer = false): number | null {
    if (missing(value)) return null;
    let number: number;
    if (typeof value === 'number') number = value;
    else if (typeof value === 'string' && /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value.trim())) {
        number = Number(value.replace(/,/g, '').trim());
    } else fail(row, `${field} must be a nonnegative number, not a formula or abbreviated K/M/B value.`);
    if (!Number.isFinite(number) || number < 0 || number > max || (integer && !Number.isSafeInteger(number))) {
        fail(row, `${field} is outside its supported numeric range.`);
    }
    return number;
}

function rank(value: unknown, row: number, field: string): number | null {
    const result = numeric(value, row, field, Number.MAX_SAFE_INTEGER, true);
    if (result === 0) fail(row, `${field} must be a positive rank or null.`);
    return result;
}

function duration(value: unknown, row: number): number | null {
    if (typeof value === 'string' && value.includes(':')) {
        const match = value.trim().match(/^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/);
        if (!match) fail(row, 'visit duration must be seconds, MM:SS or HH:MM:SS.');
        return numeric(Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]), row, 'visit duration', 86400);
    }
    return numeric(value, row, 'visit duration', 86400);
}

function context<T extends string>(value: unknown, allowed: readonly T[], row: number, field: string): T | null {
    if (missing(value)) return null;
    if (typeof value !== 'string') fail(row, `${field} must be a supported text label.`);
    const normalized = value.trim().toLowerCase().replace(/[ _]+/g, '-');
    if (!allowed.includes(normalized as T)) fail(row, `${field} has an unsupported label.`);
    return normalized as T;
}

function observation(raw: unknown, row: number, provider: string, dropped: Set<string>): Observation {
    const values = canonicalRow(raw, row, dropped);
    const domain = normalizeImportDomain(values.domain, row);
    const month = monthValue(values.month, row);
    let country: string | null = null;
    if (!missing(values.country)) {
        if (typeof values.country !== 'string' || !/^(?:world|[a-z]{2})$/i.test(values.country.trim())) fail(row, 'country must be world or a two-letter country scope.');
        country = values.country.trim().toLowerCase();
    }
    let category: string | null = null;
    if (!missing(values.category)) {
        if (typeof values.category !== 'string' || values.category.length > 200 || /[\x00-\x1f\x7f]/.test(values.category)) fail(row, 'category must be a short, single-line label.');
        category = values.category.trim();
    }
    let bounceRate: number | null;
    if (Object.hasOwn(values, 'bounceRateFraction')) {
        const fraction = numeric(values.bounceRateFraction, row, 'bounceRateFraction', 1);
        bounceRate = fraction === null ? null : fraction * 100;
    } else {
        const percent = typeof values.bounceRate === 'string' ? values.bounceRate.trim().replace(/%$/, '').trim() : values.bounceRate;
        bounceRate = numeric(percent, row, 'bounceRate (percent)', 100);
    }
    const result: Observation = {
        domain, month, country, dataProvider: provider, category,
        trafficType: context(values.trafficType, ['all-traffic', 'desktop', 'mobile-web'], row, 'trafficType'),
        measurementType: context(values.measurementType, ['estimated', 'measured'], row, 'measurementType'),
        globalRank: rank(values.globalRank, row, 'globalRank'),
        categoryRank: rank(values.categoryRank, row, 'categoryRank'),
        monthlyVisits: numeric(values.monthlyVisits, row, 'monthlyVisits', Number.MAX_SAFE_INTEGER, true),
        pagesPerVisit: numeric(values.pagesPerVisit, row, 'pagesPerVisit', 10000),
        avgVisitDuration: duration(values.avgVisitDuration, row),
        bounceRate,
    };
    if (METRICS.every((key) => result[key] === null)) fail(row, 'at least one numeric traffic, engagement or rank metric is required.');
    return result;
}

function scopeKey(value: Observation): string {
    return JSON.stringify([value.dataProvider, value.country, value.trafficType, value.measurementType]);
}

function hasContext(value: Observation): boolean {
    return value.country !== null && value.trafficType !== null && value.measurementType !== null;
}

function round(value: number): number { return Number(value.toFixed(6)); }
function difference(current: Observation, previous: Observation, key: Metric): number | null {
    return current[key] === null || previous[key] === null ? null : round(current[key]! - previous[key]!);
}
function monthIndex(month: string): number { return Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1; }

export function buildTrends(observations: Observation[]): Trend[] {
    const previous = new Map<string, Observation>();
    return observations.map((current) => {
        const key = scopeKey(current);
        const prior = previous.get(key);
        const comparable = hasContext(current) && prior !== undefined;
        const visitsChange = comparable ? difference(current, prior, 'monthlyVisits') : null;
        const result: Trend = {
            current,
            previousMonth: prior?.month ?? null,
            periodGapMonths: prior ? monthIndex(current.month) - monthIndex(prior.month) : null,
            isMonthOverMonth: comparable && monthIndex(current.month) - monthIndex(prior.month) === 1,
            comparisonStatus: !hasContext(current) ? 'context_missing' : prior ? 'comparable' : 'first_observation',
            visitsChange,
            visitsChangePercent: visitsChange === null || prior?.monthlyVisits === null || !prior?.monthlyVisits
                ? null : round(visitsChange / prior.monthlyVisits * 100),
            globalRankChange: comparable ? difference(current, prior, 'globalRank') : null,
            categoryRankChange: comparable && current.category !== null && current.category === prior.category
                ? difference(current, prior, 'categoryRank') : null,
            pagesPerVisitChange: comparable ? difference(current, prior, 'pagesPerVisit') : null,
            avgVisitDurationChangeSeconds: comparable ? difference(current, prior, 'avgVisitDuration') : null,
            bounceRateChangePercentagePoints: comparable ? difference(current, prior, 'bounceRate') : null,
        };
        previous.set(key, current);
        return result;
    });
}

export function selectMode(input: unknown): 'demo' | 'import' | 'official-api' {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ImportInputError('Provide authorized import data or explicitly configured official API input.');
    const value = input as RawRow;
    if (value.mode !== undefined && !['demo', 'import', 'official-api'].includes(String(value.mode))) throw new ImportInputError('mode must be demo, import or official-api.');
    const hasImport = (typeof value.importCsv === 'string' && value.importCsv.trim() !== '') || value.importRecords !== undefined;
    if (value.mode === 'demo') {
        if (hasImport || (value.importCsv !== undefined && typeof value.importCsv !== 'string')
            || (value.apiKey !== undefined && (typeof value.apiKey !== 'string' || value.apiKey.trim() !== ''))) {
            throw new ImportInputError('Demo accepts no imported observations or API key. Select import or official-api explicitly for your data.');
        }
        return 'demo';
    }
    if (value.mode === 'official-api') {
        if (hasImport) throw new ImportInputError('Official API mode cannot also contain import data. Select import mode instead.');
        return 'official-api';
    }
    if (value.mode === 'import' || hasImport) return 'import';
    // Existing API tasks omit mode. No schema default overrides their explicit key.
    return typeof value.apiKey === 'string' && value.apiKey.trim() !== '' ? 'official-api' : 'import';
}

export function prepareImport(input: unknown, now = new Date()): ImportPlan {
    if (selectMode(input) !== 'import') throw new ImportInputError('Expected import mode.');
    const value = input as RawRow;
    if (value.authorizedData !== true) throw new ImportInputError('Confirm authorizedData: true only for data you have permission to process.');
    if (typeof value.importSource !== 'string' || !value.importSource.trim() || value.importSource.length > 100
        || /[\x00-\x1f\x7f]/.test(value.importSource)) throw new ImportInputError('importSource must identify your export provider in a short, single-line label.');
    const provider = value.importSource.trim();
    const hasCsv = typeof value.importCsv === 'string' && value.importCsv.trim() !== '';
    const hasRecords = value.importRecords !== undefined;
    if (value.importCsv !== undefined && typeof value.importCsv !== 'string') throw new ImportInputError('importCsv must be CSV text.');
    if (hasCsv === hasRecords) throw new ImportInputError('Provide exactly one of importCsv or importRecords.');
    let rawRows: unknown[];
    if (hasCsv) rawRows = parseCsv(value.importCsv as string);
    else {
        if (!Array.isArray(value.importRecords) || value.importRecords.length === 0 || value.importRecords.length > MAX_IMPORT_ROWS) {
            throw new ImportInputError('importRecords must contain 1–1,000 observation objects.');
        }
        let serialized: string;
        try { serialized = JSON.stringify(value.importRecords); }
        catch { throw new ImportInputError('importRecords must be JSON-serializable.'); }
        if (Buffer.byteLength(serialized, 'utf8') > MAX_IMPORT_BYTES) throw new ImportInputError('JSON records exceed the 2 MiB input limit.');
        rawRows = value.importRecords;
    }
    const maxResults = value.maxResults ?? 1;
    if (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 1000) throw new ImportInputError('maxResults must be an integer between 1 and 1,000 domains.');
    const dropped = new Set<string>();
    const unique = new Map<string, Observation>();
    let duplicates = 0;
    rawRows.forEach((raw, index) => {
        const item = observation(raw, index + 1, provider, dropped);
        const key = JSON.stringify([item.domain, item.month, scopeKey(item)]);
        const existing = unique.get(key);
        if (existing) {
            if (JSON.stringify(existing) !== JSON.stringify(item)) fail(index + 1, 'conflicting observations for the same domain, month and scope; resolve them before importing.');
            duplicates += 1;
        } else unique.set(key, item);
    });
    const domains = new Map<string, Observation[]>();
    for (const item of unique.values()) {
        const list = domains.get(item.domain) ?? [];
        list.push(item); domains.set(item.domain, list);
    }
    const records = [...domains.entries()].slice(0, maxResults).map(([domain, observations]): ImportDomainRecord => {
        observations.sort((a, b) => a.month.localeCompare(b.month) || scopeKey(a).localeCompare(scopeKey(b)));
        return {
            recordType: 'authorized-traffic-import', domain, source: 'user-authorized-import', dataProvider: provider,
            importedAt: now.toISOString(), observationCount: observations.length,
            incompleteContextCount: observations.filter((item) => !hasContext(item)).length,
            observations, trends: buildTrends(observations),
        };
    });
    return {
        records, inputRowCount: rawRows.length, normalizedObservationCount: unique.size,
        duplicateObservationsRemoved: duplicates, inputDomainCount: domains.size,
        selectedDomainCount: records.length, omittedDomainCount: domains.size - records.length,
        unsupportedColumnsDropped: dropped.size, dataProvider: provider,
    };
}

export interface ComparisonRow extends Observation {
    previousMonth: string | null;
    periodGapMonths: number | null;
    isMonthOverMonth: boolean;
    comparisonStatus: Trend['comparisonStatus'];
    visitsChange: number | null;
    visitsChangePercent: number | null;
    globalRankChange: number | null;
    categoryRankChange: number | null;
    pagesPerVisitChange: number | null;
    avgVisitDurationChangeSeconds: number | null;
    bounceRateChangePercentagePoints: number | null;
    includedDomainSharePercent: number | null;
    comparisonPeerCount: number;
}

/** Cohorts use only saved domains and exactly matched month/source/scope/basis. */
export function comparisonRows(records: ImportDomainRecord[]): ComparisonRow[] {
    const cohorts = new Map<string, Observation[]>();
    for (const record of records) for (const item of record.observations) {
        if (!hasContext(item) || item.monthlyVisits === null) continue;
        const key = `${item.month}:${scopeKey(item)}`;
        const cohort = cohorts.get(key) ?? [];
        cohort.push(item); cohorts.set(key, cohort);
    }
    return records.flatMap((record) => record.trends.map(({ current, ...trend }) => {
        const peers = hasContext(current) && current.monthlyVisits !== null ? cohorts.get(`${current.month}:${scopeKey(current)}`) ?? [] : [];
        const total = peers.reduce((sum, item) => sum + item.monthlyVisits!, 0);
        return {
            ...current, ...trend,
            includedDomainSharePercent: peers.length >= 2 && total > 0 && current.monthlyVisits !== null
                ? round(current.monthlyVisits / total * 100) : null,
            comparisonPeerCount: peers.length,
        };
    }));
}

export function csvCell(value: unknown): string {
    let text = value === null || value === undefined ? '' : String(value);
    // Neutralize Excel/Sheets formula prefixes, including leading whitespace.
    if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

export function comparisonCsv(records: ImportDomainRecord[]): string {
    const fields: (keyof ComparisonRow)[] = [
        'domain', 'month', 'country', 'trafficType', 'measurementType', 'dataProvider', 'category',
        ...METRICS, 'previousMonth', 'periodGapMonths', 'isMonthOverMonth', 'comparisonStatus',
        'visitsChange', 'visitsChangePercent', 'globalRankChange', 'categoryRankChange',
        'pagesPerVisitChange', 'avgVisitDurationChangeSeconds', 'bounceRateChangePercentagePoints',
        'includedDomainSharePercent', 'comparisonPeerCount',
    ];
    return [fields.map(csvCell).join(','), ...comparisonRows(records).map((row) => fields.map((field) => csvCell(row[field])).join(','))].join('\r\n');
}

function markdownText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#!|]/g, '\\$&');
}

export function importMarkdown(records: ImportDomainRecord[]): string {
    const lines = [
        '# Authorized website traffic import report', '',
        'This report analyzes user-provided observations. No live Similarweb lookup, scraping, API request or source verification was performed.', '',
        `Saved website analyses: ${records.length}.`, '',
        'Comparisons require matching provider, country, traffic type and measurement basis. Missing values remain unknown.',
        'Included-domain shares are shares of this saved comparison set, not market shares. Non-adjacent months are not month-over-month comparisons.',
        'Rank changes use current minus previous (a negative rank change is an improvement). Bounce changes use percentage points.', '',
    ];
    for (const record of records) {
        lines.push(`## ${record.domain}`, '', `Provider label supplied by user: ${markdownText(record.dataProvider)}.`,
            `Observations: ${record.observationCount}; missing comparison context: ${record.incompleteContextCount}.`, '',
            '| Month | Country | Traffic type | Basis | Visits | Visits change % | Status |',
            '| --- | --- | --- | --- | ---: | ---: | --- |');
        for (const trend of record.trends) {
            const item = trend.current;
            lines.push(`| ${item.month} | ${item.country ?? 'unknown'} | ${item.trafficType ?? 'unknown'} | ${item.measurementType ?? 'unknown'} | ${item.monthlyVisits ?? 'unknown'} | ${trend.visitsChangePercent ?? 'unknown'} | ${trend.comparisonStatus}${trend.periodGapMonths !== null && trend.periodGapMonths > 1 ? `; ${trend.periodGapMonths}-month gap` : ''} |`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
