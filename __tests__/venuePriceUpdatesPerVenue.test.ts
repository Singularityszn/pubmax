import { promises as fsPromises, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/venue/[id]/route";
import { resetVenueDetailCachesForTests } from "@/lib/venueDetailIndex";
import { resetVenueAliasesForTests } from "@/lib/venueAliases";
import { resetUkPriceBundleForTests } from "@/lib/ukPriceBundle.server";
import { resetVenuePriceUpdatesForTests } from "@/lib/priceUpdates.server";
import { parseDrinkPriceUpdates } from "@/lib/drinkPriceUpdates";
import { venueMenuLookupKeys } from "@/lib/venueMenu";
import { stableVenueIdFromKey, venueFromDetailPayload } from "@/lib/venues";
import { venuePriceUpdatesOf, type VenuePriceUpdates } from "@/lib/venuePriceUpdates";

/**
 * THE DRINKS TAB READS ITS OVERLAYS PER VENUE.
 *
 * The two observed price-update packs are 1862 KB and 1519 KB of national
 * rows, and the Drinks tab drew a handful of them about one pub. Measured cold
 * on the audit's phone rig, opening the tab on `/map?sel=` cost 3381 KB for
 * rows about every other pub in the country. `/api/venue/[id]` is the per-venue
 * door the sheet already opens, and it already carries `bundlePrices` for the
 * same reason, so the venue's own rows ride on the detail it fetches anyway.
 */

const ROOT = path.resolve(__dirname, "..");
const DRINK_PATH = path.join(ROOT, "public", "data", "drink_price_updates", "latest.json");

/** The audit's own pub: resolvable, with no row in either pack. */
const PUB_WITH_NO_ROWS = "venue-1vle947";

function generatedAtOf(raw: unknown): number {
  const stamp = Date.parse(String((raw as { generatedAt?: unknown })?.generatedAt ?? ""));
  return Number.isFinite(stamp) ? stamp : Date.now();
}

const drinkRaw = JSON.parse(readFileSync(DRINK_PATH, "utf8")) as unknown;
const drinkRows = parseDrinkPriceUpdates(drinkRaw, generatedAtOf(drinkRaw));

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

type DetailBody = {
  venue: Parameters<typeof venueFromDetailPayload>[0] & {
    priceUpdates?: VenuePriceUpdates | null;
  };
};

async function detail(id: string): Promise<{ status: number; body: DetailBody }> {
  const res = await GET(new Request(`http://localhost/api/venue/${id}`), ctx(id));
  return { status: res.status, body: (await res.json()) as DetailBody };
}

/** The first overlay row whose pub the detail index resolves. */
async function resolvablePubWithRows(): Promise<{ id: string; key: string }> {
  for (const row of drinkRows) {
    const id = stableVenueIdFromKey(row.venueKey);
    const { status, body } = await detail(id);
    if (status !== 200) continue;
    const keys = venueMenuLookupKeys(venueFromDetailPayload(body.venue));
    if (keys.includes(row.venueKey)) return { id, key: row.venueKey };
  }
  throw new Error("no overlay row the detail index can resolve");
}

beforeEach(() => {
  resetVenueDetailCachesForTests();
  resetVenueAliasesForTests();
  resetUkPriceBundleForTests();
  resetVenuePriceUpdatesForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/venue/[id] carries this pub's own price updates", () => {
  it("the overlay file holds rows, or this test says nothing", () => {
    expect(drinkRows.length).toBeGreaterThan(0);
  });

  it("answers the rows whose venueKey is this pub's, and no others", async () => {
    const found = await resolvablePubWithRows();

    const { body } = await detail(found.id);
    const updates = venuePriceUpdatesOf(venueFromDetailPayload(body.venue));
    expect(updates.drink.length).toBeGreaterThan(0);
    expect(updates.drink.some((row) => row.venueKey === found.key)).toBe(true);

    const keys = new Set(venueMenuLookupKeys(venueFromDetailPayload(body.venue)));
    for (const row of [...updates.drink, ...updates.food]) {
      expect(keys.has(row.venueKey)).toBe(true);
    }
    // A national pack is a national pack: the scoped answer is a handful of
    // rows about one pub, never the file.
    expect(updates.drink.length).toBeLessThan(drinkRows.length);
  });

  it("publishes an empty pair for a pub the packs hold no row about", async () => {
    const { status, body } = await detail(PUB_WITH_NO_ROWS);
    expect(status).toBe(200);
    expect(body.venue.priceUpdates).toEqual({ drink: [], food: [] });
  });

  it("publishes null when a pack cannot be read, and reads again on the next open", async () => {
    const found = await resolvablePubWithRows();
    resetVenuePriceUpdatesForTests();

    const realReadFile = fsPromises.readFile.bind(fsPromises) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    const readFile = vi.spyOn(fsPromises, "readFile").mockImplementation(((
      file: unknown,
      ...rest: unknown[]
    ) =>
      String(file).includes("price_updates")
        ? Promise.reject(new Error("EIO"))
        : realReadFile(file, ...rest)) as typeof fsPromises.readFile);

    const unread = await detail(found.id);
    expect(unread.status).toBe(200);
    expect(unread.body.venue.priceUpdates).toBeNull();

    readFile.mockRestore();

    const read = await detail(found.id);
    const rows = read.body.venue.priceUpdates?.drink ?? [];
    expect(rows.some((row) => row.venueKey === found.key)).toBe(true);
  });
});
