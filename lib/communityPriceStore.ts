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
//
// TRUST IS COUNTED HERE, ENFORCED ELSEWHERE. Reads attach `corroborations` -
// how many independent submitters back the figure - derived from the per-
// (venue, category, actor) rows already stored, with no schema change and no
// extra write. The store never DECIDES anything with it: the map-side gate
// (threshold + 30-day age) lives in the one merge seam,
// components/map/communityPriceSignals.ts, and the policy constants it reads
// live in lib/communityPrice.ts.

import {
  agreesWithinTolerance,
  COMMUNITY_PRICE_MAX_AGE_MS,
  isCorroborated,
  isWithinMaxAge,
  roundToPennies,
  type CommunityPrice,
  type CommunityPriceInput,
  type CommunityPriceMapCandidate,
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

export type CommunityPriceReadResult = {
  prices: CommunityPrice[];
  degraded: boolean;
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
   * first, each carrying its independent-submitter count (`corroborations`) so
   * the read path can apply the trust threshold. NEVER throws; `degraded`
   * distinguishes an unavailable durable read from an honest empty.
   */
  latestForVenue(venueId: string, now?: number): Promise<CommunityPriceReadResult>;
  /**
   * How many (venue, drink category) pairs currently have a figure the map is
   * allowed to paint - corroborated by a second independent submitter AND
   * inside the age window. The flywheel number, read-only: it asks the SAME
   * `bestCorroboratedCandidate` + `isCorroborated` pair the per-venue read
   * uses, so it can never report a category the map would refuse. NEVER
   * throws; `degraded` marks an unavailable durable read rather than a real 0.
   */
  countCorroboratedCategories(now?: number): Promise<CorroboratedCategoryCount>;
};

export type CorroboratedCategoryCount = {
  /** Distinct (venue, category) pairs whose map candidate is corroborated. */
  count: number;
  /** True when the scan hit its row cap, so `count` is a floor, not a total. */
  truncated: boolean;
  degraded: boolean;
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
// Cap the corroboration roll-up's durable scan. Deliberately bounded: this is a
// dashboard number on a cached route, not a report, and an unbounded table scan
// is not something a read path should ever be able to ask for. When the cap is
// hit the answer is reported as a floor (`truncated`), never as a total.
const CORROBORATION_SCAN_ROWS = 20_000;

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
 * The bucket a row counts as ONE submitter under. An attributed row is its own
 * device. Unattributed rows (actor null - IP hashing was unavailable) all share
 * a single bucket: we cannot prove two of them came from different people, and
 * the whole point of the threshold is INDEPENDENCE, so the honest reading is
 * "at most one unattributed voice". Note this is stricter than the durable
 * table's unique constraint, which lets NULL-actor rows stack - deliberately:
 * storage keeps every observation, the trust count refuses to assume they are
 * different drinkers.
 */
function submitterBucket(actor: string | null): string {
  // The "anon:" sentinel cannot be produced by the "a:" branch, so a crafted
  // actor token can never impersonate the unattributed bucket or vice versa.
  return actor === null ? "anon:*" : `a:${actor}`;
}

/**
 * How many INDEPENDENT submitters back `reference`, counting whoever logged it.
 * Only rows for the same drink category that agree within the shared tolerance
 * count; a device that reported a different figure is not corroborating this
 * one, it is contradicting it.
 */
function countCorroborations(rows: StoredPrice[], reference: StoredPrice): number {
  const submitters = new Set<string>();
  for (const row of rows) {
    if (row.drinkCategory !== reference.drinkCategory) continue;
    if (!agreesWithinTolerance(reference.priceGbp, row.priceGbp)) continue;
    submitters.add(submitterBucket(row.actor));
  }
  return submitters.size;
}

/**
 * The category's MAP candidate: the agreement cluster with the most
 * independent submitters, restricted to rows still inside the age window, ties
 * broken by freshness. Every row anchors its own cluster (the set of rows
 * agreeing with it within the shared tolerance), which mirrors exactly how
 * `corroborations` is counted for the sheet row - one definition of agreement,
 * two questions asked of it. This is what stops a lone fresh disagreement
 * un-painting an already-corroborated figure: the sheet row stays freshest-
 * wins, but the map follows the best-backed in-window figure until a
 * contradiction itself reaches the threshold. Null when the category has no
 * in-window row at all.
 */
function bestCorroboratedCandidate(
  categoryRows: StoredPrice[],
  now: number,
): CommunityPriceMapCandidate | null {
  let best: StoredPrice | null = null;
  let bestCount = 0;
  for (const row of categoryRows) {
    if (!isWithinMaxAge(row, now)) continue;
    const count = countCorroborations(categoryRows, row);
    // `>=` on the freshness tie for the same reason as the freshest-wins
    // reduction below: a same-millisecond tie prefers the later row in the scan.
    if (
      !best ||
      count > bestCount ||
      (count === bestCount && row.submittedAt >= best.submittedAt)
    ) {
      best = row;
      bestCount = count;
    }
  }
  if (!best) return null;
  return { priceGbp: best.priceGbp, submittedAt: best.submittedAt, corroborations: bestCount };
}

/**
 * Reduce raw observations to ONE per drink category - the freshest wins -
 * ordered newest-first, each carrying how many independent submitters agree
 * with it plus the category's best-corroborated in-window `mapCandidate`.
 * Shared by both backends so the memory store and the durable store can never
 * disagree about what "the community price" is, or about how much the map
 * should trust it. Actor tokens are counted here and dropped here; they never
 * leave the store (see `published`).
 */
function freshestPerCategory(rows: StoredPrice[], now: number): CommunityPrice[] {
  const byCategory = new Map<DrinkCategory, StoredPrice>();
  for (const row of rows) {
    const held = byCategory.get(row.drinkCategory);
    // `>=`, not `>`: two devices CAN land in the same millisecond, and a strict
    // comparison silently made "freshest wins" mean "first of the tie wins" -
    // so the second drinker's price was dropped from the read and their tap
    // never showed. On a tie the later row in the scan wins, which is the later
    // write in the memory backend and a stable pick in the durable one (rows
    // arrive submitted_at desc, so a tied group's order is Postgres's, not
    // ours). Either answer is defensible for a true tie; being deterministic
    // and preferring the later write is the one that matches the contract.
    if (!held || row.submittedAt >= held.submittedAt) byCategory.set(row.drinkCategory, row);
  }
  return [...byCategory.entries()]
    .map(([category, row]) => {
      const categoryRows = rows.filter((r) => r.drinkCategory === category);
      const candidate = bestCorroboratedCandidate(categoryRows, now);
      return {
        ...published(row),
        corroborations: countCorroborations(categoryRows, row),
        ...(candidate ? { mapCandidate: candidate } : {}),
      };
    })
    .sort((a, b) => b.submittedAt - a.submittedAt);
}

/**
 * Count the (venue, category) pairs whose MAP candidate is corroborated. Asks
 * the same two questions the per-venue read already asks - the best in-window
 * agreement cluster, then the threshold - so this roll-up and the map can never
 * disagree about what counts. Grouping is by venue AND category because a pub
 * with a trusted pint and a trusted cocktail is two facts the map can paint.
 */
function countCorroboratedIn(rows: StoredPrice[], now: number): number {
  const groups = new Map<string, StoredPrice[]>();
  for (const row of rows) {
    // NUL separator: neither a cleaned venue id (control chars are stripped)
    // nor a category can contain it, so two keys can never collide.
    const key = `${row.venueId}\u0000${row.drinkCategory}`;
    const held = groups.get(key);
    if (held) held.push(row);
    else groups.set(key, [row]);
  }
  let count = 0;
  for (const group of groups.values()) {
    const candidate = bestCorroboratedCandidate(group, now);
    if (candidate && isCorroborated(candidate)) count += 1;
  }
  return count;
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

  async latestForVenue(venueId, now = Date.now()) {
    const key = cleanVenueId(venueId);
    if (!key) return { prices: [], degraded: false };
    return {
      prices: freshestPerCategory(venues.get(key) ?? [], now),
      degraded: false,
    };
  },

  async countCorroboratedCategories(now = Date.now()) {
    const rows: StoredPrice[] = [];
    for (const venueRows of venues.values()) rows.push(...venueRows);
    const scanned = rows.slice(0, CORROBORATION_SCAN_ROWS);
    return {
      count: countCorroboratedIn(scanned, now),
      truncated: rows.length > scanned.length,
      degraded: false,
    };
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
function rowsToPrices(rows: unknown, venueId: string): StoredPrice[] {
  if (!Array.isArray(rows)) return [];
  const out: StoredPrice[] = [];
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
    // A non-string actor (null, or absent on an older projection) is the
    // unattributed bucket - never coerced into a distinct submitter.
    const actor = typeof row.actor === "string" && row.actor !== "" ? row.actor : null;
    out.push({ ...toPrice(venueId, category, pennies, submittedAt), actor });
  }
  return out;
}

/**
 * The same guarded projection as `rowsToPrices`, but for the cross-venue
 * roll-up, so each row carries its OWN venue id instead of an assumed one. A
 * malformed row is skipped rather than coerced, exactly as above.
 */
function rowsToCountableRows(rows: unknown): StoredPrice[] {
  if (!Array.isArray(rows)) return [];
  const out: StoredPrice[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const venueId = cleanVenueId((row as Record<string, unknown>).venue_id);
    if (!venueId) continue;
    out.push(...rowsToPrices([row], venueId));
  }
  return out;
}

async function selectVenuePrices(venueId: string, now: number): Promise<CommunityPrice[]> {
  // `actor` is selected ONLY to count independent submitters in
  // freshestPerCategory; it is dropped again by `published` and never crosses
  // the store boundary. Raw tokens stay API-side (migration 0054's RLS note).
  const { data, error } = await admin()
    .from("community_prices")
    .select("drink_category, price_pennies, submitted_at, actor")
    .eq("venue_id", venueId)
    .order("submitted_at", { ascending: false })
    .limit(VENUE_SCAN_ROWS);
  if (error) throw new Error(error.message);
  return freshestPerCategory(rowsToPrices(data, venueId), now);
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

  async latestForVenue(venueId, now = Date.now()) {
    const key = cleanVenueId(venueId);
    if (!key) return { prices: [], degraded: false };
    // Explicit, like the write guard above: without it the result type is
    // inferred from `run` alone (degraded: false) and the degraded branches
    // stop type-checking.
    return guard<CommunityPriceReadResult>({
      context: "read",
      onSchemaMiss: async () => ({
        prices: (await memoryCommunityPriceStore.latestForVenue(key, now)).prices,
        degraded: true,
      }),
      message: "read failed - returning no community prices",
      onError: () => ({ prices: [], degraded: true }),
      run: async () => ({
        prices: await selectVenuePrices(key, now),
        degraded: false,
      }),
    });
  },

  async countCorroboratedCategories(now = Date.now()) {
    return guard<CorroboratedCategoryCount>({
      context: "corroborated-count",
      // A schema miss is not "zero corroborated prices" - it is the same
      // keyless/pre-migration world the memory store already answers for.
      onSchemaMiss: () => memoryCommunityPriceStore.countCorroboratedCategories(now),
      message: "corroborated count failed - reporting degraded",
      onError: () => ({ count: 0, truncated: false, degraded: true }),
      run: async () => {
        // Only in-window rows can back a map candidate, so the age gate is
        // pushed into the query rather than paid for in scanned rows.
        const since = new Date(now - COMMUNITY_PRICE_MAX_AGE_MS).toISOString();
        const { data, error } = await admin()
          .from("community_prices")
          .select("venue_id, drink_category, price_pennies, submitted_at, actor")
          .gte("submitted_at", since)
          .order("submitted_at", { ascending: false })
          .limit(CORROBORATION_SCAN_ROWS);
        if (error) throw new Error(error.message);
        const rows = rowsToCountableRows(data);
        return {
          count: countCorroboratedIn(rows, now),
          truncated: Array.isArray(data) && data.length >= CORROBORATION_SCAN_ROWS,
          degraded: false,
        };
      },
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

/**
 * How many (venue, drink category) pairs the map is currently allowed to paint
 * a community price for - the contribution flywheel's real number. NEVER throws.
 */
export function countCorroboratedCommunityCategories(
  now: number = Date.now(),
): Promise<CorroboratedCategoryCount> {
  return communityPriceStore().countCorroboratedCategories(now);
}

/** The freshest community price per drink category at one venue. NEVER throws. */
export function readCommunityPrices(
  venueId: string,
  now: number = Date.now(),
): Promise<CommunityPrice[]> {
  return readCommunityPricesWithStatus(venueId, now).then((result) => result.prices);
}

export function readCommunityPricesWithStatus(
  venueId: string,
  now: number = Date.now(),
): Promise<CommunityPriceReadResult> {
  return communityPriceStore().latestForVenue(venueId, now);
}

/** Test-only: clear the in-memory observations between cases. */
export function __resetCommunityPrices(): void {
  venues.clear();
  resetSchemaMissWarnings();
}
