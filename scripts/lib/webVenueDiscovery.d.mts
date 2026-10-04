import type { DiscoveryCity } from "./parallelVenueDiscovery.mjs";
export function pageText(markdown: unknown): string;
export function pageVenues(page: { text: string; title?: string | null; landedUrl: string; city: DiscoveryCity; district: string }): Array<{ name: string; kind: string; address: string; website: string | null; lat: null; lng: null; evidence: Array<{ url: string; excerpt: string }> }>;
export function webPageResult(page: { landedUrl: string; text: string; title?: string | null }, city: DiscoveryCity, district: string): { output: { type: "json"; content: { venues: unknown[] }; basis: Array<{ field: string; confidence: string; citations: Array<{ url: string; excerpts: string[] }> }> } };
export function nonVenueSource(url: string): string | null;
export function rankSearchResults(results: Array<{ url?: string; title?: string; content?: string; raw_content?: string | null; score?: number }> | null | undefined, district: string): string[];
export function webQueries(city: { displayName: string }, district: string, category: { label: string }): string[];
export function readFailureIsDefinitive(failure: { status?: number; error?: unknown }): boolean;
