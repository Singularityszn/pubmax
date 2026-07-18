// Hand-written types for the plain-JS shard-plan module (allowJs is off, so
// tsc needs a declaration to typecheck the unit tests that import it). Keep in
// lockstep with scripts/lib/slimShards.mjs.

export const OUTER_MAX_PRICED_RATIO: number;
export const OUTER_MIN_VENUES: number;
export const MANIFEST_FILE: string;
export const CORE_FILE: string;
export const SHARD_VERSION: number;

export interface SlimShardRow {
  id: string;
  name?: unknown;
  lat?: unknown;
  lng?: unknown;
  cheapestPrice?: number | null;
  borough?: unknown;
  [key: string]: unknown;
}

export type ShardBbox = [number, number, number, number];

export interface OuterShard {
  borough: string;
  venues: SlimShardRow[];
}

export interface ShardPlan {
  core: SlimShardRow[];
  outer: Map<string, OuterShard>;
}

export interface ShardManifestEntry {
  id: string;
  core: boolean;
  url: string;
  count: number;
  bbox: ShardBbox;
  borough?: string;
}

export interface ShardManifest {
  version: number;
  shards: ShardManifestEntry[];
}

export function dataUrl(fileName: string): string;
export function slugifyBorough(borough: unknown): string;
export function shardFileForSlug(slug: string): string;
export function computeBbox(venues: Array<{ lat?: unknown; lng?: unknown }>): ShardBbox;
export function classifySlimShards(slim: SlimShardRow[]): ShardPlan;
export function buildShardManifest(plan: ShardPlan): ShardManifest;
