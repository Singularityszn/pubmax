export type HeritagePlaceConflict = {
  reason: "borough-stated-in-fact" | "borough-named-in-source-reference";
  stated: string;
  venueBorough: string;
  why: string;
};

export type HeritagePlaceFact = {
  fact?: string | null;
  sourceRef?: string | null;
  [key: string]: unknown;
};

export function statedBoroughs(text: string | null | undefined): string[];
export function referenceDisambiguator(
  sourceRef: string | null | undefined,
): string | null;
export function heritagePlaceConflict(input: {
  text?: string | null;
  sourceRef?: string | null;
  venueBorough?: string | null;
}): HeritagePlaceConflict | null;
export function partitionFactsByPlace<T extends HeritagePlaceFact>(
  facts: readonly T[] | null | undefined,
  venueBorough: string | null | undefined,
): { published: T[]; quarantined: { fact: T; conflict: HeritagePlaceConflict }[] };
