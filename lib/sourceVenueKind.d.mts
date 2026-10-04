import type { VenueKind, VenuePrice } from "./venues";

export type SourceVenueKindResolution =
  | { status: "unknown" }
  | { status: "stated"; kind: Extract<VenueKind, "pub" | "bar"> }
  | { status: "conflict"; diagnostic: string };

export function stampedOsmId(row: Pick<VenuePrice, "data_quality_notes">): string | null;
export function resolveSourceVenueKind(rows: VenuePrice[]): SourceVenueKindResolution;
export function assertSourceVenueKinds(rows: VenuePrice[]): void;
