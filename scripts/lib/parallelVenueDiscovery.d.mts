export interface DiscoveryCity { id: string; displayName: string; bbox: [number, number, number, number] }
export interface DiscoveryVenue {
  id?: string; name: string; kind: "pub" | "bar" | "restaurant"; address: string; postcode: string;
  locality: string; website: string | null; lat: number | null; lng: number | null;
  coordinatePrecision: "source-coordinate" | "postcode-centroid" | null;
  sourceUrls: string[]; evidence: Array<{ url: string; excerpt: string }>; observedAt: string;
}
export function postcodeIn(value: unknown): string | null;
export function allowedEvidenceUrl(value: unknown): boolean;
export function inCity(lat: unknown, lng: unknown, city: DiscoveryCity): boolean;
export function parseTaskVenues(result: unknown, city: DiscoveryCity, observedAt: string): { candidates: DiscoveryVenue[]; rejected: Array<{ name: string; reason: string }> };
export function sameVenue(a: { name: string; lat: number; lng: number; address?: string; coordinatePrecision?: string }, b: { name: string; lat: number; lng: number; address?: string; coordinatePrecision?: string }): boolean;
export function dedupeVenues<T extends { name: string; lat: number; lng: number; address?: string; id?: string; osmId?: string }>(candidates: T[], existing: Array<{ name: string; lat: number; lng: number; address?: string; id?: string; osmId?: string }>): { accepted: T[]; duplicates: Array<{ name: string; matchedName: string; matchedId: string | null }> };
export function validateDiscoveryPack<T>(pack: T, city: DiscoveryCity): T;
export function mergeCityVenueSources<T extends { pubs: Array<{ name: string; lat: number; lng: number }>; fetchedAt?: string }>(osmPack: T, discoveryPack: unknown, city: DiscoveryCity): T;
