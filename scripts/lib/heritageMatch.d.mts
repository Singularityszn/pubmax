export const STRONG_MATCH_M: number;
export const CONTAIN_MATCH_M: number;
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number;
export function normaliseName(value: unknown): string;
export function coreTokens(value: unknown): string[];
export function hasPubMarker(name: unknown): boolean;
export function buildingTypeWord(name: unknown): string;
export function titleCaseName(name: unknown): string;
export function buildFactText(grade: unknown, name: unknown): string | null;
export function listingNamesAdjacentStructure(
  pubName: unknown,
  listingName: unknown,
): boolean;

export type HeritageMatchResult = {
  matched: boolean;
  tier: "exact" | "contained" | null;
  distanceM: number;
};

export type HeritagePub = { name: string; lat: number; lng: number };
export type HeritageListing = {
  name: string;
  grade: string;
  lat: number;
  lng: number;
  listEntry?: number;
  listDate?: number;
};

export function cheapHeritageMatch(
  pub: HeritagePub,
  listing: HeritageListing,
): HeritageMatchResult;
export function evaluateMatch(
  pub: HeritagePub,
  listing: HeritageListing,
): HeritageMatchResult;
export function bestMatch(
  pub: HeritagePub,
  candidates: HeritageListing[],
): (HeritageMatchResult & { listing: HeritageListing }) | null;
