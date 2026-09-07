// Types for scripts/hyped-pubs-ingest.mjs, the `lib/buildInfo.mjs` idiom: the
// script is plain ESM because a `node` CLI cannot import TypeScript, and this
// sidecar is how the unit fence reads it with types.

export declare const DROP_REASONS: readonly string[];

export interface HypedPubsIngestSource {
  label: string;
  url: string;
  observedAt: string;
}

export interface HypedPubsIngestRow {
  name: string;
  area: string;
  venueId: string | null;
  whyLine: string;
  sources: HypedPubsIngestSource[];
  score: number;
  mentions: number;
}

export interface HypedPubsIngestFile {
  version: number;
  generatedAt: string;
  city: string;
  rows: HypedPubsIngestRow[];
}

export interface HypedPubsIngestReport {
  read: number;
  published: number;
  matched: number;
  unmatchedIds: number;
  drops: Record<string, number>;
}

export interface HypedPubsIngestVenue {
  id: string;
  name: string;
  borough?: string;
}

export declare function normaliseVenueName(value: unknown): string;

export declare function buildHypedPubsFile(
  input: unknown,
  venues: readonly HypedPubsIngestVenue[],
  now?: number,
): { file: HypedPubsIngestFile; report: HypedPubsIngestReport };
