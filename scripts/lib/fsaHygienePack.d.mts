export const FSA_HYGIENE_PACK_VERSION: 1;
export const FSA_SOURCE: Readonly<{
  source: string;
  sourceUrl: string;
  apiUrl: string;
  license: string;
  licenseUrl: string;
  attribution: string;
}>;
export const FSA_RATING_VALUES: readonly string[];
export type FsaPackRow = [rating: string, ratingDay: string | null, authority: string | null];
export type FsaHygienePack = {
  version: 1;
  source: string;
  sourceUrl: string;
  apiUrl: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  retrievedAt: string;
  counts: { wanted: number; returned: number; kept: number; notInScheme: number; conflicted: number; notReturned: number };
  ratings: Record<string, FsaPackRow>;
};
export function compactEstablishment(establishment: unknown): FsaPackRow | null;
export function wantedFhrsIds(linksPack: unknown): Set<number>;
export function buildFsaHygienePack(input: {
  wanted: Set<number>;
  establishments: readonly unknown[];
  retrievedAt: string;
}): FsaHygienePack;
