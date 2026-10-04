export interface DiscoveryCity { id: string; displayName: string; bbox: [number, number, number, number] }
export interface DiscoveryVenue {
  id?: string; name: string; kind: "pub" | "bar" | "club" | "restaurant"; address: string; postcode: string;
  locality: string; website: string | null; lat: number | null; lng: number | null;
  coordinatePrecision: "source-coordinate" | "postcode-centroid" | null;
  sourceUrls: string[]; evidence: Array<{ url: string; excerpt: string }>; observedAt: string;
}
export function postcodeIn(value: unknown): string | null;
export function isListingUrl(url: string): boolean;
export const GENERIC_NAME_WORDS: Set<string>;
export function words(value: unknown): string[];
export function ownSiteFor(name: unknown, landedUrl: string, city: { displayName: string }): string | null;
export function allowedEvidenceUrl(value: unknown): boolean;
export function withoutName(quotes: string, name: unknown): string;
export function statesDrinking(kind: string, quotes: string, name: unknown): boolean;
export function discoveredKind<K extends string | undefined>(row: { name: unknown; kind: K; evidence?: Array<{ url: string; excerpt: string }> }): Exclude<K, "club"> | "bar" | "club";
export function inCity(lat: unknown, lng: unknown, city: DiscoveryCity): boolean;
export function citationBindsIdentity(row: { name: string; address: string; evidence: Array<{ excerpt: string }> }, city: DiscoveryCity, options?: { local?: boolean }): boolean;
export function unseenNames(rows: Array<{ name?: unknown } | null>, known: Array<{ name: string }>): string[];
export function postcodeDistricts(rows: Array<{ lat: unknown; lng: unknown; postcode?: string | null; address?: string | null }>, city: DiscoveryCity): string[];
export function parseTaskVenues(result: unknown, city: DiscoveryCity, observedAt: string, options?: { local?: boolean }): { candidates: DiscoveryVenue[]; rejected: Array<{ name: string; reason: string }> };
export function streetIdentity(address: unknown): { street: string; from: number | null; to: number | null } | null;
export function sameVenue(a: { name: string; lat: number; lng: number; address?: string; coordinatePrecision?: string }, b: { name: string; lat: number; lng: number; address?: string; coordinatePrecision?: string }): boolean;
type ShippedRow = { name?: string | null; lat?: number | null; lng?: number | null; address?: string; kind?: string | null; osmId?: string };
export function venueBases(packs: { ukPubs: ShippedRow[]; ukDrink: ShippedRow[]; ukFood: ShippedRow[]; ukWork: ShippedRow[]; cityPubs: ShippedRow[]; london: Array<{ pub_name: string; latitude: number; longitude: number; address?: string }> }): { known: Array<{ name: string; lat: number; lng: number; address?: string; osmId?: string }>; shipped: Array<{ name: string; lat: number; lng: number; address?: string; osmId?: string }> };
export function dedupeVenues<T extends { name: string; lat: number; lng: number; address?: string; id?: string; osmId?: string }>(candidates: T[], existing: Array<{ name: string; lat: number; lng: number; address?: string; id?: string; osmId?: string }>): { accepted: T[]; duplicates: Array<{ name: string; id: string | null; matchedName: string; matchedId: string | null }> };
export function validateDiscoveryPack<T>(pack: T, city: DiscoveryCity): T;
export function assembleCityDiscoveries<T extends { name: string; lat: number; lng: number; address?: string; id?: string }>(input: { found: T[]; previous: T[]; existing: Array<{ name: string; lat: number; lng: number; address?: string; id?: string; osmId?: string }>; city: DiscoveryCity }): { venues: T[]; accepted: T[]; retained: Array<{ name: string; id: string | null }>; duplicates: Array<{ name: string; matchedName: string; matchedId: string | null }>; withdrawn: Array<{ name: string; id: string | null; reason: string; matchedName?: string; matchedId?: string | null }>; repeats: number };
export function mergeCityVenueSources<T extends { pubs: Array<{ name: string; lat: number; lng: number }>; fetchedAt?: string }>(osmPack: T, discoveryPack: unknown, city: DiscoveryCity): T;

export function gateVenueEvidence<T extends DiscoveryVenue>(rows: T[], city: DiscoveryCity, permission: (url: string) => Promise<{ outcome: string; reason?: string }>): Promise<{ venues: T[]; rejected: Array<{ name: string; id: string | null; reason: string; sources: Array<{ url: string; outcome: string; reason?: string }> }> }>;
