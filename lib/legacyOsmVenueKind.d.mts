export function venueKindCorrectionKey(name: unknown, address: unknown): string;

export function legacyOsmVenueKind(rows: readonly {
  pub_name?: unknown;
  address?: unknown;
  data_quality_notes?: unknown;
  comment?: unknown;
}[]): "bar" | undefined;
