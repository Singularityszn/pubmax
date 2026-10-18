export const ATTRIBUTION: string;
export type BuiltListing = {
  listEntry: number;
  grade: string;
  listedYear: number | null;
  name: string;
  fact: string;
  url: string;
  distanceM: number;
};
export type NhlePoint = {
  listEntry: number;
  name: string;
  grade: string;
  listDate?: number | null;
  lat: number;
  lng: number;
};
export const VERIFIED_LISTINGS: Readonly<Record<string, number>>;
export function buildListings(
  venues: ReadonlyArray<{ id: string; name: string; lat: number; lng: number }>,
  points: ReadonlyArray<NhlePoint>,
  options?: { ownedBase?: ReadonlyArray<{ id: string; name: string; lat: number; lng: number }> },
): Record<string, BuiltListing>;
export function serialise(listings: Record<string, BuiltListing>, retrievedAt: string): string;
export function serialiseRead(points: ReadonlyArray<NhlePoint>, retrievedAt: string): string;
export function parseRead(doc: unknown): { retrievedAt: string | null; points: NhlePoint[] };
