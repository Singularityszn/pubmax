export const CATEGORIES: Array<{ id: string; label: string }>;
export const PROVIDERS: string[];
export function parseArgs(argv: string[]): { cities: string[] | null; matches: number; concurrency: number; processor: string; provider: string; list: boolean; refresh: boolean; help: boolean; check: boolean };
export function taskRequest(request: { objective: string; context: Record<string, unknown>; known: Array<{ name: string; postcode?: string | null }>; processor: string }): { processor: string; source_policy: unknown; input: { objective: string; knownVenueNames: string[]; contextIsPartial: boolean; totalKnownVenues: number } & Record<string, unknown>; task_spec: unknown };
