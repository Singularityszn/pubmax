export function parseArgs(argv: string[]): { cities: string[] | null; cityLimit: number; matches: number; processor: string; list: boolean; refresh: boolean; help: boolean; check: boolean };
export function researchExclusions(known: Array<{ name: string; postcode?: string }>): { knownVenueNames: string[]; contextIsPartial: boolean; totalKnownVenues: number };
