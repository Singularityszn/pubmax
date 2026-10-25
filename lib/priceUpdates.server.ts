import "server-only";

import { promises as fs } from "fs";
import path from "path";

import {
  parseDrinkPriceUpdates,
  type DrinkPriceUpdate,
} from "@/lib/drinkPriceUpdates";
import {
  parseFoodPriceUpdates,
  type FoodPriceUpdate,
} from "@/lib/foodPriceUpdates";
import { namedNonBeerBundleUpdates, type VenuePriceUpdates } from "@/lib/venuePriceUpdates";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";

// The two observed price-update packs, read once per process and indexed by the
// venue key each row is about.
//
// ONE READ, LIKE EVERY OTHER BUNDLED DATASET HERE (lib/ukPriceBundle.server.ts,
// app/feed/feedSightings.server.ts). The pair is 3.4 MB of build-time JSON, so
// re-parsing it per request is the mistake those modules already exist to stop.
//
// A READ THAT FAILED IS NEVER CACHED and is never an empty pack either: the
// answer is null, so a sheet that cannot tell "this pub has no sourced price"
// from "we could not look" never words one as the other. One bad render would
// otherwise leave an empty overlay in place for the life of the process.

type PriceUpdatesIndex = {
  drinkByKey: Map<string, DrinkPriceUpdate[]>;
  foodByKey: Map<string, FoodPriceUpdate[]>;
};

const DRINK_PATH = path.join(
  process.cwd(),
  "public",
  "data",
  "drink_price_updates",
  "latest.json",
);
const FOOD_PATH = path.join(
  process.cwd(),
  "public",
  "data",
  "food_price_updates",
  "latest.json",
);

let cached: PriceUpdatesIndex | null = null;
let pending: Promise<PriceUpdatesIndex | null> | null = null;

function generatedAtOf(raw: unknown): number {
  const stamp = Date.parse(String((raw as { generatedAt?: unknown })?.generatedAt ?? ""));
  return Number.isFinite(stamp) ? stamp : Date.now();
}

function indexByKey<Row extends { venueKey: string }>(rows: Row[]): Map<string, Row[]> {
  const byKey = new Map<string, Row[]>();
  for (const row of rows) {
    byKey.set(row.venueKey, [...(byKey.get(row.venueKey) ?? []), row]);
  }
  return byKey;
}

async function readJson(file: string): Promise<unknown> {
  /* turbopackIgnore: true */
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw) as unknown;
}

async function load(): Promise<PriceUpdatesIndex | null> {
  try {
    const [drinkRaw, foodRaw] = await Promise.all([
      readJson(DRINK_PATH),
      readJson(FOOD_PATH),
    ]);
    const index: PriceUpdatesIndex = {
      drinkByKey: indexByKey(parseDrinkPriceUpdates(drinkRaw, generatedAtOf(drinkRaw))),
      foodByKey: indexByKey(parseFoodPriceUpdates(foodRaw, generatedAtOf(foodRaw))),
    };
    cached = index;
    return index;
  } catch {
    // Deliberately NOT cached: a read we could not run says nothing about the
    // packs, and freezing it would turn one bad moment into a permanent one.
    return null;
  } finally {
    pending = null;
  }
}

async function readPriceUpdates(): Promise<PriceUpdatesIndex | null> {
  if (cached) return cached;
  pending ??= load();
  return pending;
}

/** Every drink-price update row. Null distinguishes a failed read from an empty pack. */
export async function readAllDrinkPriceUpdates(): Promise<DrinkPriceUpdate[] | null> {
  const index = await readPriceUpdates();
  return index ? [...index.drinkByKey.values()].flat() : null;
}

export async function allDrinkPriceUpdates(): Promise<DrinkPriceUpdate[]> {
  return (await readAllDrinkPriceUpdates()) ?? [];
}

/**
 * Overlay rows and eligible site-harvest menu rows for one venue, scoped by
 * its lookup keys (lib/venueMenu.ts `venueMenuLookupKeys`).
 *
 * Null when the read failed, so the caller publishes an absence it can tell
 * from an empty answer.
 */
export async function venuePriceUpdatesFor(
  keys: readonly string[],
): Promise<VenuePriceUpdates | null> {
  const index = await readPriceUpdates();
  if (!index) return null;
  const drink: DrinkPriceUpdate[] = [];
  const food: FoodPriceUpdate[] = [];
  for (const key of keys) {
    drink.push(...(index.drinkByKey.get(key) ?? []));
    food.push(...(index.foodByKey.get(key) ?? []));
  }
  const bundle = await ukPriceBundleRowsByVenue();
  if (bundle.status === "unavailable") return null;
  for (const key of new Set(keys)) {
    drink.push(...namedNonBeerBundleUpdates((bundle.byVenue.get(key) ?? []).filter((row) => row.lane === "site-harvest")));
  }
  return { drink, food };
}

export function resetVenuePriceUpdatesForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
    pending = null;
  }
}
