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
import type { VenuePriceUpdates } from "@/lib/venuePriceUpdates";

// The two observed price-update packs, read once per process and indexed by the
// venue key each row is about.
//
// ONE READ, LIKE EVERY OTHER BUNDLED DATASET HERE (lib/ukPriceBundle.server.ts,
// app/feed/feedSightings.server.ts). The pair is 3.4 MB of build-time JSON, so
// re-parsing it per request is the mistake those modules already exist to stop.
//
// A READ THAT FAILED IS NEVER CACHED and is never an empty pack either: the
// answer is three-way (`ready`, `empty`, `unavailable`) so a sheet that cannot
// tell "this pub has no sourced price" from "we could not look" never words one
// as the other. One bad render would otherwise leave an empty overlay in place
// for the life of the process.

export type PriceUpdatesReadStatus = "ready" | "empty" | "unavailable";

type PriceUpdatesRead = {
  status: PriceUpdatesReadStatus;
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

const UNAVAILABLE: PriceUpdatesRead = {
  status: "unavailable",
  drinkByKey: new Map(),
  foodByKey: new Map(),
};

let cached: PriceUpdatesRead | null = null;
let pending: Promise<PriceUpdatesRead> | null = null;

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

async function load(): Promise<PriceUpdatesRead> {
  try {
    const [drinkRaw, foodRaw] = await Promise.all([
      readJson(DRINK_PATH),
      readJson(FOOD_PATH),
    ]);
    const drink = parseDrinkPriceUpdates(drinkRaw, generatedAtOf(drinkRaw));
    const food = parseFoodPriceUpdates(foodRaw, generatedAtOf(foodRaw));
    const read: PriceUpdatesRead = {
      status: drink.length > 0 || food.length > 0 ? "ready" : "empty",
      drinkByKey: indexByKey(drink),
      foodByKey: indexByKey(food),
    };
    cached = read;
    return read;
  } catch {
    // Deliberately NOT cached: a read we could not run says nothing about the
    // packs, and freezing it would turn one bad moment into a permanent one.
    return UNAVAILABLE;
  } finally {
    pending = null;
  }
}

async function readPriceUpdates(): Promise<PriceUpdatesRead> {
  if (cached) return cached;
  pending ??= load();
  return pending;
}

/**
 * Every overlay row either pack holds about one venue, scoped by the keys that
 * venue answers to (lib/venueMenu.ts `venueMenuLookupKeys`).
 *
 * `updates` is null when the read failed, so the caller publishes an absence it
 * can tell from an empty answer.
 */
export async function venuePriceUpdatesFor(keys: readonly string[]): Promise<{
  status: PriceUpdatesReadStatus;
  updates: VenuePriceUpdates | null;
}> {
  const read = await readPriceUpdates();
  if (read.status === "unavailable") return { status: read.status, updates: null };
  const drink: DrinkPriceUpdate[] = [];
  const food: FoodPriceUpdate[] = [];
  for (const key of keys) {
    drink.push(...(read.drinkByKey.get(key) ?? []));
    food.push(...(read.foodByKey.get(key) ?? []));
  }
  return { status: read.status, updates: { drink, food } };
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
