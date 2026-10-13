// Permissible-source DRINK price refresh layer (E2 of docs/PRD_ALL_DRINKS.md).
//
// This mirrors lib/priceUpdates.ts exactly, but targets a per-drink row on the
// E1 drinks menu (drink name + category + price) instead of a single per-venue
// cheapest-pint price. Same governance, same validation discipline, same merge
// precedence:
//
//   - every price carries { source: {label, url, licence}, observedAt };
//   - a refreshed price is presented as "sourced" (attributed), NEVER as a
//     community contribution;
//   - stale is never presented as live — observedAt is always surfaced and a
//     future observedAt is rejected outright;
//   - a fresher COMMUNITY observation always beats a sourced update (the
//     community layer is the live signal; this layer only fills in absent
//     that live signal).
//
// zod-free: hand-rolled guards mirroring lib/priceUpdates.ts isValidPriceUpdate,
// so a malformed hand-authored / machine-written update file drops the bad row
// instead of poisoning the drinks layer.

import type { Provenance } from "@/lib/curation";
import { demoDrinksEnabled } from "@/lib/demoContent";
import { isHttpUrl } from "@/lib/httpUrl";
import { isFiniteNumber, isNonEmptyString, isValidObservedAt } from "@/lib/priceUpdateRowShape";
import {
  alcoholTypeForDrink,
  isDemoDrinkSource,
  isDrinkCategory,
  type Drink,
  type DrinkCategory,
  type DrinkProvenance,
} from "@/lib/drinks";

// One attributed drink-price observation from a permissible source. `venueKey`
// is the canonical grouping key (lib/venues.ts venueGroupingKey) so an update
// targets exactly the same venue the app groups by — no fuzzy name matching.
// `drinkName` + `category` identify the specific menu row within that venue.
type DrinkPriceUpdateLane = "publisher" | "demo";

export type DrinkPriceUpdate = {
  venueKey: string;
  drinkName: string;
  category: DrinkCategory;
  priceGbp: number;
  producer?: string;
  abv?: number;
  style?: string;
  region?: string;
  servingSize?: string;
  /** Reviewed menu-row identity. Legacy rows retain their existing rating IDs. */
  itemId?: string;
  source: { label: string; url: string; licence: string };
  observedAt: string; // ISO-8601
  /** Semantic display lane, resolved once when raw overlay data is parsed. */
  lane: DrinkPriceUpdateLane;
};

// The provenance a refreshed drink price is stamped with. A sourced
// (attributed) price is authoritative-but-attributed; it is never
// "contributor"/"demo".
export const DRINK_PRICE_UPDATE_PROVENANCE: Provenance = "sourced";

// The provenance stamp the drinks menu reads to attribute a refreshed price.
type DrinkPriceProvenance = {
  provenance: Provenance; // always "sourced"
  sourceLabel: string;
  sourceUrl: string;
  licence: string;
  observedAt: string;
};

// A minimal drink-menu row shape this layer can merge sourced prices onto.
// Deliberately narrow (not importing lib/drinks.ts, which is owned by E1) so
// this module has no dependency on E1 landing first; any row shape with these
// fields plus an optional community-freshness stamp works.
export type DrinkMenuRow = {
  venueKey: string;
  drinkName: string;
  category: DrinkCategory;
  priceGbp: number | null;
  // Freshness of the most recent COMMUNITY observation for this exact drink
  // row, if any. Mirrors Venue.latestContributorAt in lib/venues.ts. null when
  // no community observation exists yet.
  latestContributorAt: string | null;
  servingSize?: string;
};

function isValidOptionalString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isValidOptionalAbv(value: unknown): boolean {
  return value === undefined || (isFiniteNumber(value) && value >= 0 && value <= 100);
}

// Hand-rolled row guard — drop malformed rows rather than throw. `now` is
// injectable for deterministic tests.
export function isValidDrinkPriceUpdate(value: unknown, now: number = Date.now()): boolean {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (!isNonEmptyString(row.venueKey)) return false;
  if (!isNonEmptyString(row.drinkName)) return false;
  if (!isDrinkCategory(row.category)) return false;
  // A price must be a finite, non-negative number. 0 is allowed (free-drink
  // promo) but a negative price is nonsense.
  if (!isFiniteNumber(row.priceGbp) || row.priceGbp < 0) return false;
  if (!isValidOptionalString(row.producer)) return false;
  if (!isValidOptionalAbv(row.abv)) return false;
  if (!isValidOptionalString(row.style)) return false;
  if (!isValidOptionalString(row.region)) return false;
  if (!isValidOptionalString(row.servingSize)) return false;
  if (row.itemId !== undefined) {
    const identityText = [
      [row.venueKey as string, 300],
      [row.drinkName as string, 160],
      ...((row.servingSize as string | undefined) === undefined ? [] : [[row.servingSize as string, 80]]),
    ] as Array<[string, number]>;
    if (identityText.some(([text, limit]) => text.trim() !== text || text.length > limit || /\p{Cc}/u.test(text))) return false;
    if (typeof row.itemId !== "string" || !/^drink-item-[0-9a-f]{16}$/.test(row.itemId)) return false;
    if (row.itemId !== reviewedDrinkItemId({
      venueKey: row.venueKey as string,
      drinkName: row.drinkName as string,
      category: row.category as string,
      servingSize: row.servingSize as string | undefined,
    })) return false;
  }
  const source = row.source;
  if (typeof source !== "object" || source === null) return false;
  const src = source as Record<string, unknown>;
  if (!isNonEmptyString(src.label)) return false;
  if (!isHttpUrl(src.url, { allowWhitespace: true })) return false;
  // A licence string is mandatory — an unlicensed source is not permissible
  // (governance: every fact is {source, licence, observedAt}).
  if (!isNonEmptyString(src.licence)) return false;
  if (!isValidObservedAt(row.observedAt, now)) return false;
  if (row.lane !== undefined && row.lane !== "publisher" && row.lane !== "demo") {
    return false;
  }
  return true;
}

// A stated serving is part of the price identity. An unknown serving never
// overwrites a stated glass, bottle or pint.
function rowKey(venueKey: string, drinkName: string, category: string, servingSize?: string): string {
  return JSON.stringify([venueKey, drinkName.toLowerCase(), category.toLowerCase(), servingSize?.trim().toLowerCase() ?? ""]);
}

/** Separate namespace prevents reviewed servings from choosing a legacy rating ref. */
export function reviewedDrinkItemId(row: {
  venueKey: string;
  drinkName: string;
  category: string;
  servingSize?: string;
}): string {
  const input = rowKey(row.venueKey, row.drinkName, row.category, row.servingSize);
  const hash = (text: string) => {
    let value = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      value ^= text.charCodeAt(i);
      value = Math.imul(value, 16777619);
    }
    return (value >>> 0).toString(16).padStart(8, "0");
  };
  return `drink-item-${hash(input)}${hash(`serving\u0000${input}`)}`;
}

function updateProvenance(update: DrinkPriceUpdate): DrinkProvenance {
  return {
    source: update.source.label,
    sourceUrl: update.source.url,
    licence: update.source.licence,
    observedAt: update.observedAt,
    lane: update.lane === "demo" ? "demo" : "drink-price-update",
  };
}

function stableDrinkId(update: DrinkPriceUpdate): string {
  if (update.itemId !== undefined) {
    if (update.itemId !== reviewedDrinkItemId(update)) throw new Error("Invalid reviewed drink item ID");
    return update.itemId;
  }
  const input = `${update.venueKey}\u0000${update.category}\u0000${update.drinkName}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `drink-${(hash >>> 0).toString(36)}`;
}

// The demo lane of the overlay is the same class of row as a seeded menu, so
// it answers to the same opt-in gate (#1427): a production menu shows only
// rows a publisher or a drinker put on record.
export function visibleDrinkPriceUpdates(
  updates: readonly DrinkPriceUpdate[],
): DrinkPriceUpdate[] {
  if (demoDrinksEnabled()) return [...updates];
  return updates.filter((update) => update.lane !== "demo");
}

export function drinkFromPriceUpdate(update: DrinkPriceUpdate): Drink {
  return {
    id: stableDrinkId(update),
    category: update.category,
    name: update.drinkName,
    producer: update.producer,
    abv: update.abv,
    alcoholType: alcoholTypeForDrink({ name: update.drinkName, abv: update.abv, category: update.category }),
    style: update.style,
    region: update.region,
    servingSize: update.servingSize,
    priceGbp: update.priceGbp,
    provenance: updateProvenance(update),
  };
}

export function applyDrinkPriceUpdatesToMenu(
  venueKey: string,
  existingDrinks: Drink[],
  updates: DrinkPriceUpdate[],
  venueKeys: readonly string[] = [venueKey],
): Drink[] {
  const keySet = new Set([venueKey, ...venueKeys]);
  const scoped = visibleDrinkPriceUpdates(updates).filter(
    (update) => keySet.has(update.venueKey),
  );
  if (scoped.length === 0) return existingDrinks;
  const byKey = new Map(
    scoped.map((update) => [rowKey(venueKey, update.drinkName, update.category, update.servingSize), update] as const),
  );
  const used = new Set<string>();

  const merged = existingDrinks.map((drink) => {
    const key = rowKey(venueKey, drink.name, drink.category, drink.servingSize);
    const update = byKey.get(key);
    if (!update) return drink;
    used.add(key);
    return {
      ...drink,
      priceGbp: update.priceGbp,
      provenance: updateProvenance(update),
      producer: update.producer ?? drink.producer,
      abv: update.abv ?? drink.abv,
      alcoholType: alcoholTypeForDrink({
        name: update.drinkName,
        abv: update.abv ?? drink.abv,
        category: update.category,
      }),
      style: update.style ?? drink.style,
      region: update.region ?? drink.region,
      servingSize: update.servingSize ?? drink.servingSize,
    };
  });

  for (const update of scoped) {
    const key = rowKey(venueKey, update.drinkName, update.category, update.servingSize);
    if (!used.has(key)) merged.push(drinkFromPriceUpdate(update));
  }
  return merged;
}

// Parse a raw drink_price_updates file body → clean DrinkPriceUpdate[]. Accepts
// either a bare array or a `{ updates: [...] }` envelope. Malformed rows are
// dropped. When more than one legacy update targets the same named serving, the
// newest observedAt wins (so an append-only file naturally supersedes older
// observations). Explicit item IDs must be unique, and distinct servings may
// not share a legacy rating reference.
export function parseDrinkPriceUpdates(raw: unknown, now: number = Date.now()): DrinkPriceUpdate[] {
  const rows = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { updates?: unknown }).updates)
      ? (raw as { updates: unknown[] }).updates
      : [];
  const newestByKey = new Map<string, DrinkPriceUpdate>();
  const suppliedIds = new Set<string>();
  const rejectedIds = new Set<string>();
  const identityKeysById = new Map<string, string>();
  for (const candidate of rows) {
    if (!isValidDrinkPriceUpdate(candidate, now)) continue;
    const rawRow = candidate as Omit<DrinkPriceUpdate, "lane"> & {
      lane?: DrinkPriceUpdateLane;
    };
    const row: DrinkPriceUpdate = {
      ...rawRow,
      lane:
        rawRow.lane ??
        (isDemoDrinkSource(rawRow.source.label) ? "demo" : "publisher"),
    };
    const key = rowKey(row.venueKey, row.drinkName, row.category, row.servingSize);
    const id = stableDrinkId(row);
    if (row.itemId !== undefined) {
      if (suppliedIds.has(row.itemId)) rejectedIds.add(row.itemId);
      suppliedIds.add(row.itemId);
    }
    const heldKey = identityKeysById.get(id);
    if (heldKey !== undefined && heldKey !== key) rejectedIds.add(id);
    identityKeysById.set(id, key);
    const existing = newestByKey.get(key);
    if (!existing || Date.parse(row.observedAt) > Date.parse(existing.observedAt)) {
      newestByKey.set(key, row);
    }
  }
  return Array.from(newestByKey.values()).filter((row) => !rejectedIds.has(stableDrinkId(row)));
}

// The extra fields mergeDrinkPriceUpdates folds onto a drink-menu row. Kept as
// its own type so the menu UI can read the sourced-price attribution without
// importing the merge internals.
export type PricedDrinkMenuRow<T extends DrinkMenuRow> = T & {
  // Attribution for a price that came from the refresh file. Present ONLY when
  // the sourced update actually won precedence (no fresher community
  // observation). null otherwise.
  sourcedPrice: DrinkPriceProvenance | null;
};

// Fold the drink-price-update layer into drink-menu rows, with STRICT
// precedence — identical rule to lib/priceUpdates.ts mergePriceUpdates:
//
//   1. a community observation (row.latestContributorAt set) that is at least
//      as fresh as the update ALWAYS wins — the update is ignored, the live
//      community price + freshness stand. This is the "never present stale as
//      live" and "community layer is authoritative-live" guarantee.
//   2. otherwise the sourced update overrides the static/baseline priceGbp and
//      stamps sourcedPrice attribution ({source, licence, observedAt,
//      "sourced"}).
//   3. no update for a row → baseline stands, sourcedPrice null.
//
// `keyFor` maps a menu row to its canonical venueKey (the update file's
// venueKey). Callers pass venueGroupingKey-of-venue or a precomputed map.
export function mergeDrinkPriceUpdates<T extends DrinkMenuRow>(
  existingDrinks: T[],
  updates: DrinkPriceUpdate[],
  keyFor: (row: T) => string,
): PricedDrinkMenuRow<T>[] {
  const byKey = new Map(
    visibleDrinkPriceUpdates(updates).map(
      (u) => [rowKey(u.venueKey, u.drinkName, u.category, u.servingSize), u] as const,
    ),
  );
  return existingDrinks.map((row) => {
    const update = byKey.get(rowKey(keyFor(row), row.drinkName, row.category, row.servingSize));
    if (!update) {
      return { ...row, sourcedPrice: null };
    }
    // A community observation that is at least as fresh as the sourced
    // observation wins outright — stale sourced data must never beat a live
    // community price.
    if (
      row.latestContributorAt !== null &&
      Date.parse(row.latestContributorAt) >= Date.parse(update.observedAt)
    ) {
      return { ...row, sourcedPrice: null };
    }
    return {
      ...row,
      priceGbp: update.priceGbp,
      sourcedPrice: {
        provenance: DRINK_PRICE_UPDATE_PROVENANCE,
        sourceLabel: update.source.label,
        sourceUrl: update.source.url,
        licence: update.source.licence,
        observedAt: update.observedAt,
      },
    };
  });
}
