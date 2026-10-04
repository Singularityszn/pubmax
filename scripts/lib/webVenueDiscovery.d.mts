export function pageText(markdown: unknown): string;
export function ownSiteFor(name: unknown, landedUrl: string): string | null;
export function webPageResult(page: { landedUrl: string; markdown: string; json: unknown }): { output: { type: "json"; content: { venues: unknown[] }; basis: Array<{ field: string; confidence: string; citations: Array<{ url: string; excerpts: string[] }> }> } };
export function rankSearchResults(results: Array<{ url?: string; title?: string; content?: string; raw_content?: string | null; score?: number }> | null | undefined, district: string): string[];
export function webQueries(city: { displayName: string }, district: string, category: { label: string }): string[];
