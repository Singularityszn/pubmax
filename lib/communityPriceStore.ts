// SERVER-ONLY store for community price submissions - the durable half of
// "tap a pub, log tonight's price". Browser-safe validation/labels live in
// lib/communityPrice.ts; this module must never be imported from a "use client"
// component (it pulls the Supabase admin client → node:crypto).
//
// ONE store interface, TWO implementations (process-memory + Supabase
// public.community_prices) - the exact dual-backend seam as priceConfirmStore /
// ratingsStore: Supabase when env keys exist, process-memory otherwise, chosen
// at the single communityPriceStore() seam. Until migration 0054 lands (or on a
// schema miss) the Supabase path fails soft to memory OUTSIDE production, so
// keyless dev keeps working and becomes durable the moment the table exists.
//
// APPEND-ONLY BY CONTRACT. A submission is an observation, never an edit: this
// store writes its own rows and touches NOTHING in the venue dataset, the
// scraped price CSV, or visit_reports. The scraped baseline and a community
// price coexist, each read back with its own timestamp and `source` - provenance
// is never flattened away (CONTEXT.md).
//
// Fail-soft by contract on READS (a hiccup degrades to "no community price yet",
// and the sourced baseline still renders). WRITES are honest: a hard durable
// failure comes back flagged so the route can answer 503 rather than pretend the
// tap landed.

import {
  roundToPennies,
  type CommunityPrice,
  type CommunityPriceInput,
} from "@/lib/communityPrice";
import { isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import {
  admin,
  createFailSoftGuard,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";

export type CommunityPriceWrite = CommunityPriceInput & {
  /**
   * Stable, opaque token for the submitter (server-derived hashed IP in the
   * route). Lets one device replace its OWN earlier observation for the same
   * drink instead of stacking duplicates. When omitted the write still lands,
   * it just can't be attributed back to a device.
   */
  actor?: string;
};

export type CommunityPriceWriteResult = {
  /** The stored observation, or null when the input fell outside the envelope. */
  price: CommunityPrice | null;
  /** Set when a durable write hard-failed - the submission was NOT recorded. */
  failed?: true;
};

export type CommunityPriceStore = {
  /**
   * Record an observation and return it as stored. NEVER throws; a durable
   * write that hard-fails resolves with `failed: true` so the route can answer
   * 503 (house rule: degraded dependency, not a fake success).
   */
  submit(input: CommunityPriceWrite, now?: number): Promise<CommunityPriceWriteResult>;
  /**
   * The freshest community price per drink category at one venue, newest
   * first. NEVER throws - an outage reads as "no community price yet".
   */
  latestForVenue(venueId: string, now?: number): Promise<CommunityPrice[]>;
};

// Penny envelope, mirroring lib/communityPrice.ts (£1 … £30) and the DB CHECK
// in migration 0054 - defence in depth, three layers agreeing.
const MIN_PENNIES = 100;
const MAX_PENNIES = 3_000;
const MAX_VENUE_ID = 64;
// Bound process memory in a long-lived server - evict the least-recently-
// written venue past this many distinct venues.
const MAX_VENUES = 5_000;
// Cap how many raw rows one venue read pulls. Generous for the per-category
// reduction below, bounded on purpose.
const VENUE_SCAN_ROWS = 200;

type StoredPrice = CommunityPrice & { actor: string | null };

function cleanVenueId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, MAX_VENUE_ID);
}

/** Normalise an input to storable parts, or null when out of envelope. */
function normalize(
  input: CommunityPriceWrite,
): { venueId: string; drinkCategory: DrinkCategory; pennies: number } | null {
  const venueId = cleanVenueId(input.venueId);
  if (!venueId) return null;
  if (!isDrinkCategory(input.drinkCategory)) return null;
  if (typeof input.priceGbp !== "number" || !Number.isFinite(input.priceGbp)) return null;
  const pennies = Math.round(input.priceGbp * 100);
  if (pennies < MIN_PENNIES || pennies > MAX_PENNIES) return null;
  return { venueId, drinkCategory: input.drinkCategory, pennies };
}

function toPrice(
  venueId: string,
  drinkCategory: DrinkCategory,
  pennies: number,
  submittedAt: number,
): CommunityPrice {
  return {
    venueId,
    drinkCategory,
    priceGbp: roundToPennies(pennies / 100),
    submittedAt,
    source: "community",
  };
}

/**
 * Reduce raw observations to ONE per drink category - the freshest wins -
 * ordered newest-first. Shared by both backends so the memory store and the
 * durable store can never disagree about what "the community price" is.
 */
function freshestPerCategory(rows: CommunityPrice[]): CommunityPrice[] {
  const byCategory = new Map<DrinkCategory, CommunityPrice>();
  for (const row of rows) {
    const held = byCategory.get(row.drinkCategory);
    if (!held || row.submittedAt > held.submittedAt) byCategory.set(row.drinkCategory, row);
  }
  return [...byCategory.values()].sort((a, b) => b.submittedAt - a.submittedAt);
}

/**
 * Strip the actor before a stored row leaves the store. The submitter token is
 * an internal de-duplication key, never part of the price the app reads - so
 * the boundary is spelled out here rather than relying on every caller to omit
 * it. Mirrors the durable backend, which simply never selects the column.
 */
function published(stored: StoredPrice): CommunityPrice {
  return {
    venueId: stored.venueId,
    drinkCategory: stored.drinkCategory,
    priceGbp: stored.priceGbp,
    submittedAt: stored.submittedAt,
    source: "community",
  };
}

// ── In-memory implementation ─────────────────────────────────────────────────
// One entry per venue, holding every observation for it. Module-level so it
// persists across requests within a process; never a browser global.
const venues = new Map<string, StoredPrice[]>();

/** Evict the venue with the oldest newest-observation once past the cap. */
function evictIfNeeded(): void {
  if (venues.size <= MAX_VENUES) return;
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (const [key, rows] of venues) {
    const newest = rows.reduce((max, row) => Math.max(max, row.submittedAt), 0);
    if (newest < oldestAt) {
      oldestAt = newest;
      oldestKey = key;
    }
  }
  if (oldestKey) venues.delete(oldestKey);
}

export const memoryCommunityPriceStore: CommunityPriceStore = {
  async submit(input, now = Date.now()) {
    const key = normalize(input);
    if (!key) return { price: null };
    const stored: StoredPrice = {
      ...toPrice(key.venueId, key.drinkCategory, key.pennies, now),
      actor: input.actor ?? null,
    };
    const rows = venues.get(key.venueId) ?? [];
    // One live observation per (venue, category, actor): a device correcting
    // its own entry replaces it rather than stacking a second row, so one
    // person can't weight a venue's community price twice.
    const kept = rows.filter(
      (row) =>
        !(
          row.drinkCategory === stored.drinkCategory &&
          row.actor !== null &&
          row.actor === stored.actor
        ),
    );
    kept.push(stored);
    venues.set(key.venueId, kept);
    evictIfNeeded();
    return { price: published(stored) };
  },

  async latestForVenue(venueId) {
    const key = cleanVenueId(venueId);
    if (!key) return [];
    const rows = venues.get(key) ?? [];
    return freshestPerCategory(rows.map(published));
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "community-price",
  tables: "community_prices",
  migrationHint: "apply migration 0054",
});

/**
 * Guard the untyped supabase-js projection: a malformed row is SKIPPED, never
 * coerced into a price. A fabricated £0 would be worse than a missing figure.
 */
function rowsToPrices(rows: unknown, venueId: string): CommunityPrice[] {
  if (!Array.isArray(rows)) return [];
  const out: CommunityPrice[] = [];
  for (const r of rows) {
    if (typeof r !== "object" || r === null) continue;
    const row = r as Record<string, unknown>;
    const pennies = row.price_pennies;
    const category = row.drink_category;
    const at = row.submitted_at;
    if (typeof pennies !== "number" || !Number.isFinite(pennies)) continue;
    if (pennies < MIN_PENNIES || pennies > MAX_PENNIES) continue;
    if (!isDrinkCategory(category)) continue;
    if (typeof at !== "string" || at === "") continue;
    const submittedAt = Date.parse(at);
    if (!Number.isFinite(submittedAt)) continue;
    out.push(toPrice(venueId, category, pennies, submittedAt));
  }
  return out;
}

async function selectVenuePrices(venueId: string): Promise<CommunityPrice[]> {
  const { data, error } = await admin()
    .from("community_prices")
    .select("drink_category, price_pennies, submitted_at")
    .eq("venue_id", venueId)
    .order("submitted_at", { ascending: false })
    .limit(VENUE_SCAN_ROWS);
  if (error) throw new Error(error.message);
  return freshestPerCategory(rowsToPrices(data, venueId));
}

export const supabaseCommunityPriceStore: CommunityPriceStore = {
  async submit(input, now = Date.now()) {
    const key = normalize(input);
    if (!key) return { price: null };
    const submittedAt = new Date(now).toISOString();
    // Anonymous submissions have no actor to conflict on, so they insert;
    // attributed ones upsert over this device's own earlier entry for the
    // same drink. Matches the memory store's replace-your-own rule.
    const actor = input.actor ?? null;
    // Pinned to the store's public result type: `run` returns a stored price on
    // the happy path, but the schema-miss and error paths legitimately resolve
    // to `{ price: null, failed: true }`, and inference off `run` alone would
    // narrow those away.
    return guard<CommunityPriceWriteResult>({
      context: "submit",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "community-price",
          migrationHint: "apply migration 0054",
          fallback: () => memoryCommunityPriceStore.submit(input, now),
          onProduction: async () => ({ price: null, failed: true as const }),
        }),
      message: "submit failed - flagging degraded write",
      onError: () => ({ price: null, failed: true as const }),
      run: async () => {
        const row = {
          venue_id: key.venueId,
          drink_category: key.drinkCategory,
          price_pennies: key.pennies,
          actor,
          submitted_at: submittedAt,
        };
        const { error } = actor
          ? await admin()
              .from("community_prices")
              .upsert(row, { onConflict: "venue_id,drink_category,actor" })
          : await admin().from("community_prices").insert(row);
        if (error) throw new Error(error.message);
        return { price: toPrice(key.venueId, key.drinkCategory, key.pennies, now) };
      },
    });
  },

  async latestForVenue(venueId) {
    const key = cleanVenueId(venueId);
    if (!key) return [];
    return guard({
      context: "read",
      onSchemaMiss: () => memoryCommunityPriceStore.latestForVenue(key),
      message: "read failed - returning no community prices",
      onError: () => [],
      run: () => selectVenuePrices(key),
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export function communityPriceStore(): CommunityPriceStore {
  return selectStore(memoryCommunityPriceStore, supabaseCommunityPriceStore);
}

/**
 * Record tonight's price for a (venue, drink). NEVER throws - an out-of-
 * envelope input resolves to `{ price: null }` so the optimistic UI can stand
 * on its own, and a hard durable failure comes back flagged.
 */
export function submitCommunityPrice(
  input: CommunityPriceWrite,
  now: number = Date.now(),
): Promise<CommunityPriceWriteResult> {
  return communityPriceStore().submit(input, now);
}

/** The freshest community price per drink category at one venue. NEVER throws. */
export function readCommunityPrices(venueId: string): Promise<CommunityPrice[]> {
  return communityPriceStore().latestForVenue(venueId);
}

/** Test-only: clear the in-memory observations between cases. */
export function __resetCommunityPrices(): void {
  venues.clear();
  resetSchemaMissWarnings();
}
