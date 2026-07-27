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
// MODERATION HIDES, NEVER DELETES. A row can be flagged by a reader (`report`)
// and hidden by a moderator (`moderate`) - the observation itself is kept, with
// its report metadata, exactly as the Pint Drop path does it. Hidden rows are
// filtered on the ONE read path (`freshestPerCategory`'s input), so a hidden
// price disappears from the sheet, from the corroboration count, and from the
// map candidate in a single stroke: there is no second place to remember.
// Reporting NEVER auto-hides here (unlike pint drops): a community price is the
// thing the map is made of, so taking one down is a human decision.
//
// TRUST IS COUNTED HERE, ENFORCED ELSEWHERE. Reads attach `corroborations` -
// how many independent submitters back the figure - derived from the per-
// (venue, category, actor) rows already stored, with no schema change and no
// extra write. The store never DECIDES anything with it: the map-side gate
// (threshold + 30-day age) lives in the one merge seam,
// components/map/communityPriceSignals.ts, and the policy constants it reads
// live in lib/communityPrice.ts.

import { randomUUID } from "node:crypto";

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

export type CommunityPriceCategoryIndexResult = {
  prices: CommunityPrice[];
  truncated: boolean;
  degraded: boolean;
};

/**
 * A reported/hidden observation as the moderator queue sees it. Carries the
 * report metadata the moderator needs to judge it and NOTHING that identifies
 * the submitter - the actor token stays inside the store, exactly as it does on
 * the public read path.
 */
export type ModeratorCommunityPrice = {
  id: string;
  venueId: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
  submittedAt: number;
  hidden: boolean;
  reportCount: number;
  reportedAt?: number;
  reportReason?: string;
  moderatorNote?: string;
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
   * Current public rows for selected categories across venues. Used by a map
   * lens that cannot discover a venue one sheet at a time. Actor tokens never
   * leave this method, and the scan is finite.
   */
  latestForCategories(
    categories: readonly DrinkCategory[],
    now?: number,
  ): Promise<CommunityPriceCategoryIndexResult>;
  /**
   * How many (venue, drink category) pairs currently have a figure the map is
   * allowed to paint - corroborated by a second independent submitter AND
   * inside the age window. The flywheel number, read-only: it asks the SAME
   * `bestCorroboratedCandidate` + `isCorroborated` pair the per-venue read
   * uses, so it can never report a category the map would refuse. NEVER
   * throws; `degraded` marks an unavailable durable read rather than a real 0.
   */
  countCorroboratedCategories(now?: number): Promise<CorroboratedCategoryCount>;
  /**
   * Reader flag on one observation. Records the reason and counts the report;
   * it NEVER hides by itself. False = unknown id. NEVER throws.
   */
  report(id: string, reason?: string, actorHash?: string): Promise<boolean>;
  /**
   * Moderator decision: hide the observation from every public read, or restore
   * it. The row is kept either way - this store has no delete. False = unknown
   * id. NEVER throws.
   */
  moderate(id: string, hidden: boolean, note?: string): Promise<boolean>;
  /**
   * The moderation queue: reported and/or hidden observations, newest report
   * first. NEVER throws; an unavailable durable read degrades to empty.
   */
  listForReview(limit?: number): Promise<ModeratorCommunityPrice[]>;
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
const CATEGORY_INDEX_SCAN_ROWS = 20_000;
// PostgREST silently caps any single response at the project's server-side
// max-rows setting (hosted default 1000), so one `.limit(20_000)` request can
// come back short without ever saying so. The durable scan therefore pages in
// chunks no larger than that default and derives `truncated` from the last
// page's fill, keeping the flag honest regardless of the Max Rows setting.
const CORROBORATION_SCAN_PAGE = 1_000;

type StoredPrice = CommunityPrice & {
  id: string;
  actor: string | null;
  /** Hidden by a moderator. Filtered out of every public read; never deleted. */
  hidden: boolean;
  /** Reader flags, for the moderation queue only - it decides nothing here. */
  reportCount: number;
  reportedAt?: number;
  reportReason?: string;
  moderatorNote?: string;
  /** Actors that have already flagged this row - one report each, durably. */
  reporters?: Set<string>;
};

/** Cap a free-text moderation/report reason before it is stored or shown. */
const MAX_REASON = 280;

function cleanReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, MAX_REASON);
  return cleaned === "" ? undefined : cleaned;
}

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
function freshestPerCategory(allRows: StoredPrice[], now: number): CommunityPrice[] {
  // THE one place a hidden observation leaves the public world. Filtering here
  // rather than at each call site means a hidden row cannot show on the sheet,
  // cannot corroborate a figure, and cannot become the map candidate - the
  // three questions this function answers all read the same filtered set.
  const rows = allRows.filter((row) => !row.hidden);
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
function countCorroboratedIn(allRows: StoredPrice[], now: number): number {
  // Same rule as freshestPerCategory: a hidden observation cannot corroborate
  // anything, so it cannot keep a (venue, category) pair in this count either -
  // otherwise the roll-up would report a figure the map itself refuses.
  const rows = allRows.filter((row) => !row.hidden);
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

function categoryIndexFromRows(
  allRows: StoredPrice[],
  categories: readonly DrinkCategory[],
  now: number,
  truncated: boolean,
  degraded: boolean,
): CommunityPriceCategoryIndexResult {
  const wanted = new Set(categories);
  const groups = new Map<string, StoredPrice[]>();
  for (const row of allRows) {
    if (!wanted.has(row.drinkCategory) || !isWithinMaxAge(row, now)) continue;
    const held = groups.get(row.venueId);
    if (held) held.push(row);
    else groups.set(row.venueId, [row]);
  }
  const prices = [...groups.values()]
    .flatMap((rows) => freshestPerCategory(rows, now))
    .sort((left, right) => right.submittedAt - left.submittedAt);
  return { prices, truncated, degraded };
}

/**
 * Strip the actor before a stored row leaves the store. The submitter token is
 * an internal de-duplication key, never part of the price the app reads - so
 * the boundary is spelled out here rather than relying on every caller to omit
 * it. Mirrors the durable backend, which simply never selects the column.
 */
function published(stored: StoredPrice): CommunityPrice {
  return {
    // The id DOES cross the boundary (unlike the actor): the sheet needs a
    // handle to report the row with, and it identifies an observation, not a
    // person.
    id: stored.id,
    venueId: stored.venueId,
    drinkCategory: stored.drinkCategory,
    priceGbp: stored.priceGbp,
    submittedAt: stored.submittedAt,
    source: "community",
  };
}

/** Project a stored row onto the moderator DTO. Never exposes `actor`. */
function toModeratorPrice(row: StoredPrice): ModeratorCommunityPrice {
  return {
    id: row.id,
    venueId: row.venueId,
    drinkCategory: row.drinkCategory,
    priceGbp: row.priceGbp,
    submittedAt: row.submittedAt,
    hidden: row.hidden,
    reportCount: row.reportCount,
    ...(row.reportedAt ? { reportedAt: row.reportedAt } : {}),
    ...(row.reportReason ? { reportReason: row.reportReason } : {}),
    ...(row.moderatorNote ? { moderatorNote: row.moderatorNote } : {}),
  };
}

/** Bound one moderation-queue page. Generous for a solo moderator, finite. */
const REVIEW_LIMIT = 100;

// ── In-memory implementation ─────────────────────────────────────────────────
// One entry per venue, holding every observation for it. Module-level so it
// persists across requests within a process; never a browser global.
const venues = new Map<string, StoredPrice[]>();

/**
 * The stored row with this id, or null. A linear scan on purpose: moderation is
 * a handful of calls a day against a process-memory fallback, and a second
 * id→row index would be one more thing that can disagree with the venue map.
 */
function findMemoryRow(id: string): StoredPrice | null {
  if (typeof id !== "string" || id === "") return null;
  for (const rows of venues.values()) {
    for (const row of rows) {
      if (row.id === id) return row;
    }
  }
  return null;
}

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
      id: randomUUID(),
      actor: input.actor ?? null,
      hidden: false,
      reportCount: 0,
    };
    const rows = venues.get(key.venueId) ?? [];
    // One live observation per (venue, category, actor): a device correcting
    // its own entry replaces it rather than stacking a second row, so one
    // person can't weight a venue's community price twice.
    const isOwnEarlier = (row: StoredPrice) =>
      row.drinkCategory === stored.drinkCategory &&
      row.actor !== null &&
      row.actor === stored.actor;
    const replaced = rows.find(isOwnEarlier);
    const kept = rows.filter((row) => !isOwnEarlier(row));
    // Moderation survives the correction. The durable backend's upsert writes
    // only the price columns, so `hidden_at` and the report metadata stay put
    // there; the memory backend has to carry them across deliberately, or a
    // hidden submitter could wash their price simply by logging it again -
    // and the two backends would disagree about whether that works.
    if (replaced) {
      stored.hidden = replaced.hidden;
      stored.reportCount = replaced.reportCount;
      stored.reportedAt = replaced.reportedAt;
      stored.reportReason = replaced.reportReason;
      stored.moderatorNote = replaced.moderatorNote;
      stored.reporters = replaced.reporters;
      // Keeping the id keeps a moderator's outstanding queue entry pointing at
      // a row that still exists, exactly as the durable upsert does.
      stored.id = replaced.id;
    }
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

  async latestForCategories(categories, now = Date.now()) {
    const wanted = new Set(categories.filter(isDrinkCategory));
    if (wanted.size === 0) {
      return { prices: [], truncated: false, degraded: false };
    }
    const rows: StoredPrice[] = [];
    let truncated = false;
    for (const venueRows of venues.values()) {
      for (const row of venueRows) {
        if (!wanted.has(row.drinkCategory)) continue;
        if (rows.length >= CATEGORY_INDEX_SCAN_ROWS) {
          truncated = true;
          break;
        }
        rows.push(row);
      }
      if (truncated) break;
    }
    return categoryIndexFromRows(
      rows,
      [...wanted],
      now,
      truncated,
      false,
    );
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

  async report(id, reason, actorHash) {
    const row = findMemoryRow(id);
    if (!row) return false;
    // One report per actor per row, mirroring the durable unique pair: a single
    // angry reader cannot inflate the count they are asking a human to weigh.
    // An unattributed report (no actor) still lands and still counts once.
    const reporter = actorHash && actorHash !== "" ? actorHash : null;
    if (reporter) {
      row.reporters ??= new Set<string>();
      if (row.reporters.has(reporter)) return true;
      row.reporters.add(reporter);
    }
    row.reportCount += 1;
    row.reportedAt = Date.now();
    const cleaned = cleanReason(reason);
    if (cleaned) row.reportReason = cleaned;
    return true;
  },

  async moderate(id, hidden, note) {
    const row = findMemoryRow(id);
    if (!row) return false;
    row.hidden = hidden;
    const cleaned = cleanReason(note);
    if (cleaned) row.moderatorNote = cleaned;
    return true;
  },

  async listForReview(limit = REVIEW_LIMIT) {
    const queue: StoredPrice[] = [];
    for (const rows of venues.values()) {
      for (const row of rows) {
        if (row.hidden || row.reportCount > 0) queue.push(row);
      }
    }
    return queue
      .sort((a, b) => (b.reportedAt ?? b.submittedAt) - (a.reportedAt ?? a.submittedAt))
      .slice(0, Math.max(0, limit))
      .map(toModeratorPrice);
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
    // A row we cannot identify cannot be reported or moderated, but it is still
    // a real observation - it renders, it just carries no id. (Only reachable
    // before migration 0055 adds the projection.)
    const id = typeof row.id === "string" ? row.id : "";
    out.push({
      ...toPrice(venueId, category, pennies, submittedAt),
      id,
      actor,
      // `hidden_at` absent (older projection) reads as VISIBLE, which is what
      // the table meant before moderation existed.
      hidden: typeof row.hidden_at === "string" && row.hidden_at !== "",
      reportCount:
        typeof row.report_count === "number" && Number.isFinite(row.report_count)
          ? Math.max(0, Math.floor(row.report_count))
          : 0,
    });
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
  // Hidden rows are filtered in freshestPerCategory rather than in SQL, so the
  // memory and durable backends can never disagree about what "hidden" removes
  // (sheet row, corroboration count, map candidate - all three at once).
  const { data, error } = await admin()
    .from("community_prices")
    .select("id, drink_category, price_pennies, submitted_at, actor, hidden_at, report_count")
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
        // `.select("id")` so the submitter's own receipt carries the handle it
        // would need to be reported by - and so a correction (the upsert) hands
        // back the surviving row's id, not the replaced one's.
        const { data, error } = actor
          ? await admin()
              .from("community_prices")
              .upsert(row, { onConflict: "venue_id,drink_category,actor" })
              .select("id")
          : await admin().from("community_prices").insert(row).select("id");
        if (error) throw new Error(error.message);
        const id = Array.isArray(data) && typeof data[0]?.id === "string" ? data[0].id : undefined;
        return {
          price: {
            ...toPrice(key.venueId, key.drinkCategory, key.pennies, now),
            ...(id ? { id } : {}),
          },
        };
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

  async latestForCategories(categories, now = Date.now()) {
    const wanted = [...new Set(categories.filter(isDrinkCategory))];
    if (wanted.length === 0) {
      return { prices: [], truncated: false, degraded: false };
    }
    return guard<CommunityPriceCategoryIndexResult>({
      context: "category-index",
      onSchemaMiss: async () => ({
        ...(await memoryCommunityPriceStore.latestForCategories(wanted, now)),
        degraded: true,
      }),
      message: "category index read failed - returning no community prices",
      onError: () => ({ prices: [], truncated: false, degraded: true }),
      run: async () => {
        const since = new Date(now - COMMUNITY_PRICE_MAX_AGE_MS).toISOString();
        const scanned: unknown[] = [];
        let lastPageFull = false;
        for (let offset = 0; offset < CATEGORY_INDEX_SCAN_ROWS; ) {
          const pageEnd = Math.min(
            offset + CORROBORATION_SCAN_PAGE,
            CATEGORY_INDEX_SCAN_ROWS,
          );
          const { data, error } = await admin()
            .from("community_prices")
            .select(
              "id, venue_id, drink_category, price_pennies, submitted_at, actor, hidden_at, report_count",
            )
            .in("drink_category", wanted)
            .gte("submitted_at", since)
            .order("submitted_at", { ascending: false })
            .order("id", { ascending: true })
            .range(offset, pageEnd - 1);
          if (error) throw new Error(error.message);
          const page = Array.isArray(data) ? data : [];
          scanned.push(...page);
          lastPageFull = page.length >= pageEnd - offset;
          if (!lastPageFull) break;
          offset = pageEnd;
        }
        return categoryIndexFromRows(
          rowsToCountableRows(scanned),
          wanted,
          now,
          lastPageFull,
          false,
        );
      },
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
        const scanned: unknown[] = [];
        let lastPageFull = false;
        for (let offset = 0; offset < CORROBORATION_SCAN_ROWS; ) {
          const pageEnd = Math.min(offset + CORROBORATION_SCAN_PAGE, CORROBORATION_SCAN_ROWS);
          const { data, error } = await admin()
            .from("community_prices")
            .select("venue_id, drink_category, price_pennies, submitted_at, actor, hidden_at")
            .gte("submitted_at", since)
            // The `id` tiebreak keeps the page windows disjoint when many rows
            // share one `submitted_at` instant.
            .order("submitted_at", { ascending: false })
            .order("id", { ascending: true })
            .range(offset, pageEnd - 1);
          if (error) throw new Error(error.message);
          const page = Array.isArray(data) ? data : [];
          scanned.push(...page);
          lastPageFull = page.length >= pageEnd - offset;
          if (!lastPageFull) break;
          offset = pageEnd;
        }
        const rows = rowsToCountableRows(scanned);
        return {
          count: countCorroboratedIn(rows, now),
          truncated: lastPageFull,
          degraded: false,
        };
      },
    });
  },

  async report(id, reason, actorHash) {
    if (!id) return false;
    return guard<boolean>({
      context: "report",
      onSchemaMiss: () => memoryCommunityPriceStore.report(id, reason, actorHash),
      message: "report failed",
      onError: () => false,
      run: async () => {
        // Per-actor uniqueness is the DURABLE guarantee (community_price_reports'
        // unique (community_price_id, actor_hash) in migration 0055), so a
        // repeat that slips past the route's rate limiter is an idempotent
        // no-op rather than a second count. The RPC does the insert-and-count
        // in one statement; nothing here is allowed to hide the row.
        const { data, error } = await admin().rpc("report_community_price", {
          p_id: id,
          p_actor_hash: actorHash ?? null,
          p_reason: cleanReason(reason) ?? null,
        });
        if (error) throw new Error(error.message);
        return data === true;
      },
    });
  },

  async moderate(id, hidden, note) {
    if (!id) return false;
    return guard<boolean>({
      context: "moderate",
      onSchemaMiss: () => memoryCommunityPriceStore.moderate(id, hidden, note),
      message: "moderate failed",
      onError: () => false,
      run: async () => {
        // Hide = stamp hidden_at; restore = clear it. The observation itself is
        // never deleted, so a wrong call is always reversible. A call without a
        // note leaves the previous moderator note in place, exactly as the
        // memory backend does.
        const cleaned = cleanReason(note);
        const { data, error } = await admin()
          .from("community_prices")
          .update({
            hidden_at: hidden ? new Date().toISOString() : null,
            ...(cleaned ? { moderator_note: cleaned } : {}),
            moderated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select("id");
        if (error) throw new Error(error.message);
        return Array.isArray(data) && data.length > 0;
      },
    });
  },

  async listForReview(limit = REVIEW_LIMIT) {
    return guard<ModeratorCommunityPrice[]>({
      context: "listForReview",
      onSchemaMiss: () => memoryCommunityPriceStore.listForReview(limit),
      message: "review queue read failed - returning empty",
      onError: () => [],
      run: async () => {
        const { data, error } = await admin()
          .from("community_prices")
          .select(
            "id, venue_id, drink_category, price_pennies, submitted_at, hidden_at, report_count, reported_at, report_reason, moderator_note",
          )
          .or("report_count.gt.0,hidden_at.not.is.null")
          .order("reported_at", { ascending: false, nullsFirst: false })
          .limit(Math.max(0, limit));
        if (error) throw new Error(error.message);
        return reviewRows(data);
      },
    });
  },
};

/** Narrow the untyped moderation-queue projection; a malformed row is skipped. */
function reviewRows(rows: unknown): ModeratorCommunityPrice[] {
  if (!Array.isArray(rows)) return [];
  const out: ModeratorCommunityPrice[] = [];
  for (const r of rows) {
    if (typeof r !== "object" || r === null) continue;
    const row = r as Record<string, unknown>;
    const pennies = row.price_pennies;
    if (typeof row.id !== "string" || row.id === "") continue;
    if (typeof row.venue_id !== "string" || row.venue_id === "") continue;
    if (!isDrinkCategory(row.drink_category)) continue;
    if (typeof pennies !== "number" || !Number.isFinite(pennies)) continue;
    const submittedAt = typeof row.submitted_at === "string" ? Date.parse(row.submitted_at) : NaN;
    if (!Number.isFinite(submittedAt)) continue;
    const reportedAt = typeof row.reported_at === "string" ? Date.parse(row.reported_at) : NaN;
    out.push({
      id: row.id,
      venueId: row.venue_id,
      drinkCategory: row.drink_category,
      priceGbp: roundToPennies(pennies / 100),
      submittedAt,
      hidden: typeof row.hidden_at === "string" && row.hidden_at !== "",
      reportCount:
        typeof row.report_count === "number" && Number.isFinite(row.report_count)
          ? Math.max(0, Math.floor(row.report_count))
          : 0,
      ...(Number.isFinite(reportedAt) ? { reportedAt } : {}),
      ...(cleanReason(row.report_reason) ? { reportReason: cleanReason(row.report_reason) } : {}),
      ...(cleanReason(row.moderator_note)
        ? { moderatorNote: cleanReason(row.moderator_note) }
        : {}),
    });
  }
  return out;
}

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
  // A write is the only thing that can change the category index, so it drops
  // the memo rather than leaving a submitter's own price invisible to the lens
  // for the rest of the window.
  resetCommunityPriceCategoryIndexMemo();
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

// The category index is the one read here that is neither per-venue nor
// per-actor: every caller asks the same question and gets byte-identical rows,
// and answering it costs up to CATEGORY_INDEX_SCAN_ROWS / CORROBORATION_SCAN_PAGE
// sequential durable reads. Unmemoised, an anonymous GET could bill that scan
// once per visitor and once per retry, which is a cost and an availability
// hazard rather than a correctness one.
//
// So the answer is held per category set for CATEGORY_INDEX_MEMO_MS, and the
// PROMISE is what is held, not the result: a burst of concurrent activations
// collapses onto one scan instead of racing N of them. The window is orders of
// magnitude shorter than COMMUNITY_PRICE_MAX_AGE_MS, so nothing a reader sees
// gets older than the trust policy already allows. A degraded read is never
// held: a hiccup must not pin "no prices" over the map for a minute.
const CATEGORY_INDEX_MEMO_MS = 60_000;

type CategoryIndexMemo = {
  at: number;
  pending: Promise<CommunityPriceCategoryIndexResult>;
};

const categoryIndexMemo = new Map<string, CategoryIndexMemo>();

/** Current rows for selected categories across venues. NEVER throws. */
export function readCommunityPriceCategoryIndex(
  categories: readonly DrinkCategory[],
  now: number = Date.now(),
): Promise<CommunityPriceCategoryIndexResult> {
  const key = [...new Set(categories)].sort().join(",");
  const held = categoryIndexMemo.get(key);
  if (held && now - held.at < CATEGORY_INDEX_MEMO_MS) return held.pending;
  const pending = communityPriceStore()
    .latestForCategories(categories, now)
    .then((result) => {
      if (result.degraded) categoryIndexMemo.delete(key);
      return result;
    })
    .catch((error: unknown) => {
      categoryIndexMemo.delete(key);
      throw error;
    });
  categoryIndexMemo.set(key, { at: now, pending });
  return pending;
}

/** Drop the memoised category index. Test seam, and the submit path's reset. */
export function resetCommunityPriceCategoryIndexMemo(): void {
  categoryIndexMemo.clear();
}

/**
 * Reader flag on one observation. NEVER throws; false means "no such row".
 * Records the complaint - it never hides anything by itself.
 */
export function reportCommunityPrice(
  id: string,
  reason?: string,
  actorHash?: string,
): Promise<boolean> {
  return communityPriceStore().report(id, reason, actorHash);
}

/**
 * Moderator decision: hide one community price from every public read, or
 * restore it. The observation is kept either way - hide, never delete.
 */
export function moderateCommunityPrice(
  id: string,
  hidden: boolean,
  note?: string,
): Promise<boolean> {
  // Hiding is the one read-path filter, so a moderated row must leave the
  // memoised index at the same moment it leaves the sheet.
  resetCommunityPriceCategoryIndexMemo();
  return communityPriceStore().moderate(id, hidden, note);
}

/** The moderation queue: reported and/or hidden observations. NEVER throws. */
export function listCommunityPricesForReview(
  limit?: number,
): Promise<ModeratorCommunityPrice[]> {
  return communityPriceStore().listForReview(limit);
}

/** Test-only: clear the in-memory observations between cases. */
export function __resetCommunityPrices(): void {
  venues.clear();
  resetCommunityPriceCategoryIndexMemo();
  resetSchemaMissWarnings();
}
