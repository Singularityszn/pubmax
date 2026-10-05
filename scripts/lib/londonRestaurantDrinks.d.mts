export type RestaurantCandidate = {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  postcode: string | null;
  street: string | null;
  housenumber: string | null;
  website: string | null;
};
export type SearchResult = { url?: string; title?: string; content?: string; raw_content?: string | null };
export const LONDON: { id: "london"; displayName: "London" };
export function hostOf(url: string): string;
export function taggedOwnSite(website: unknown): string | null;
export function searchBindsSite(candidate: Pick<RestaurantCandidate, "name" | "postcode" | "street" | "housenumber">, result: SearchResult): string | null;
export function searchQuery(candidate: Pick<RestaurantCandidate, "name" | "postcode" | "street" | "housenumber">): string;
export function statesRestaurantDrinks(quote: string, name: string): boolean;
export function drinksEvidence(markdown: unknown, name: string): { quote?: string; refused?: string };
export function offPremisesUrl(url: string): boolean;
export function drinkLinks(markdown: unknown, pageUrl: string, limit?: number): string[];
export function restaurantCandidate(element: unknown, deps: { statesAlcohol: (tags: Record<string, string>) => boolean; excluded: Set<string> }): RestaurantCandidate | null;
export function excludedOsmIds(exclusions: unknown): Set<string>;
export function validateRestaurantDrinksPack(pack: unknown, deps: { inGreaterLondon: (lat: number, lng: number) => boolean; exclusions: unknown }): string[];
export type ExtractAnswer = { landedUrl: string; text: string } | { unreadable: string } | { retry: string };
export function pairExtractResults(
  urls: string[],
  data: { results?: Array<{ url: string; raw_content?: string | null }>; failed_results?: Array<{ url: string; error?: unknown; status?: number }> } | null | undefined,
): Map<string, ExtractAnswer>;
export function retryableUnreadable(page: { unreadable?: string } | null | undefined): boolean;
