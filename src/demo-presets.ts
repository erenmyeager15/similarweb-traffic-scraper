import { ImportInputError } from './importer.js';

export const DEMO_PRESETS = ['us-agency-comparison', 'us-traffic-change-alerts', 'us-scope-audit'] as const;
export type DemoPreset = typeof DEMO_PRESETS[number];

/** Developer-authored examples on reserved domains, never collected or result-billed. */
export function demoPreset(input: unknown): { name: DemoPreset; rows: Record<string, unknown>[] } {
    const value = input as Record<string, unknown>;
    const requested = value.demoPreset ?? 'us-agency-comparison';
    if (typeof requested !== 'string' || !DEMO_PRESETS.includes(requested as DemoPreset)) throw new ImportInputError('demoPreset must be us-agency-comparison, us-traffic-change-alerts or us-scope-audit.');
    const name = requested as DemoPreset;
    const common = { country: 'us', trafficType: 'all-traffic', measurementType: 'estimated' };
    if (name === 'us-traffic-change-alerts') return { name, rows: [
        { ...common, domain: 'example.com', month: '2026-08', monthlyVisits: 1000, bounceRate: 45, globalRank: 100 },
        { ...common, domain: 'example.com', month: '2026-09', monthlyVisits: 700, bounceRate: 52, globalRank: 130 },
        { ...common, domain: 'example.net', month: '2026-09', monthlyVisits: 1400, bounceRate: 40, globalRank: 80 },
    ] };
    if (name === 'us-scope-audit') return { name, rows: [
        { ...common, domain: 'example.com', month: '2026-07', monthlyVisits: 1000 },
        { ...common, domain: 'example.com', month: '2026-09', monthlyVisits: 700 },
        { ...common, domain: 'example.com', month: '2026-09', country: 'world', monthlyVisits: 2000 },
        { ...common, domain: 'example.net', month: '2026-09', country: null, monthlyVisits: 1400 },
    ] };
    return { name, rows: [
        { ...common, domain: 'example.com', month: '2026-08', monthlyVisits: 1000, bounceRate: 54.9 },
        { ...common, domain: 'example.com', month: '2026-09', monthlyVisits: 1200, bounceRate: 50 },
        { ...common, domain: 'example.net', month: '2026-09', monthlyVisits: 1800, bounceRate: 45 },
    ] };
}
