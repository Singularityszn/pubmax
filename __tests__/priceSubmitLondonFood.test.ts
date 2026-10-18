// The price door's one non-pub target: a London fast-food counter
// (`venue-osm-…`, kind `food`) takes a Coke Zero or Diet Coke price and nothing
// else (lib/londonFoodPlaces.ts, resolvePriceVenueId). These cases read the
// committed London food pack and shards, so a forged id, a cafe and a pint are
// refused against the same files the deployed route opens.

import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
    verifyCallerAuth: async () =>
      authState.userId
        ? {
            status: "verified" as const,
            identity: { id: authState.userId, email: null, createdAt: null },
          }
        : { status: "absent" as const },
  };
});

const foodIndexState = vi.hoisted(() => ({ unavailable: false }));
vi.mock("@/lib/londonFoodIndex.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/londonFoodIndex.server")>();
  return {
    ...actual,
    lookupLondonFoodPlace: async (id: string) =>
      foodIndexState.unavailable
        ? { status: "unavailable" as const }
        : actual.lookupLondonFoodPlace(id),
  };
});

import { GET, POST } from "@/app/api/price-submit/route";
import { __resetCommunityPrices, readCommunityPrices } from "@/lib/communityPriceStore";
import { __resetMemoryAdultSelfAssertions } from "@/lib/adultSelfAssertionStore";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import {
  FOOD_PLACE_PRICE_REFUSAL,
  LONDON_FOOD_PACK_PATH,
  londonMcDonalds,
  parseLondonFoodPack,
} from "@/lib/londonFoodPlaces";
import { londonVenueIdFor } from "@/lib/londonVenueShards";
import { __resetPintDrops, listVisiblePintDrops } from "@/lib/pintDrops";
import { __resetMemoryPriceTrustEvents } from "@/lib/priceTrustEventStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import { defined } from "@/__tests__/helpers/defined";

const PUBLIC = path.join(__dirname, "..", "public");

function readPublicJson(relative: string): unknown {
  return JSON.parse(readFileSync(path.join(PUBLIC, relative.replace(/^\//, "")), "utf8"));
}

const foodPlaces = parseLondonFoodPack(readPublicJson(LONDON_FOOD_PACK_PATH)) ?? [];
const mcdonalds = defined(londonMcDonalds(foodPlaces)[0]);

/** A London venue-layer id that is real but not a counter: the first cafe in the shards. */
function firstShardIdOfKind(kind: string): string {
  const manifest = readPublicJson("data/london_venues/manifest.json") as {
    urlPrefix: string;
    shards: { id: string }[];
  };
  for (const shard of manifest.shards) {
    const body = readPublicJson(`${manifest.urlPrefix}${shard.id}.json`) as {
      venues: [string, string, string, number, number, string][];
    };
    const row = body.venues.find((venue) => venue[5] === kind);
    if (row) return londonVenueIdFor(row[0]);
  }
  throw new Error(`no ${kind} row in the London shards`);
}

function jpegFile(name: string): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, { type: "image/jpeg" });
}

function post(fields: Record<string, string | number>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  form.set("receipt_photo", jpegFile("bill.jpg"));
  return new Request("http://localhost/api/price-submit", { method: "POST", body: form });
}

const LUCIA = "soft-drink-lucia-special";

beforeEach(async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  foodIndexState.unavailable = false;
  __resetCommunityPrices();
  __resetMemoryPriceTrustEvents();
  __resetMemoryIdentityHandles();
  __resetMemoryProfiles();
  __resetMemoryPrivateIdentities();
  __resetMemoryAdultSelfAssertions();
  __resetPintDrops();
  authState.userId = "user-lucia";
  const onboarding = await memoryPrivateIdentityStore.completeOnboarding({
    userId: "user-lucia",
    handle: "lucia_goat",
    dateOfBirth: "1990-01-01",
  });
  expect(onboarding).toMatchObject({ ok: true });
});

describe("POST /api/price-submit at a London fast-food counter", () => {
  it("accepts a Coke Zero or Diet Coke price at a London McDonald's (201)", async () => {
    expect(mcdonalds.kind).toBe("food");
    const res = await POST(
      post({ venueId: mcdonalds.id, drinkCategory: "soft-drink", drinkSubtype: LUCIA, priceGbp: 1.79 }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { price?: { priceGbp: number; drinkCategory: string } };
    expect(body.price).toMatchObject({ priceGbp: 1.79, drinkCategory: "soft-drink" });
    expect(await readCommunityPrices(mcdonalds.id)).toEqual([
      expect.objectContaining({ venueId: mcdonalds.id, drinkCategory: "soft-drink", priceGbp: 1.79 }),
    ]);
    // A soft drink pairs no Pint Drop, so nothing reaches a pint lane.
    expect(listVisiblePintDrops(mcdonalds.id)).toEqual([]);
  });

  it("accepts either leaf of the Lucia lens", async () => {
    for (const drinkSubtype of ["soft-drink-coke-zero", "soft-drink-diet-coke"]) {
      __resetCommunityPrices();
      const res = await POST(
        post({ venueId: mcdonalds.id, drinkCategory: "soft-drink", drinkSubtype, priceGbp: 1.89 }),
      );
      expect(res.status, drinkSubtype).toBe(201);
    }
  });

  it("refuses a forged venue-osm id on its shape alone, and stores nothing", async () => {
    const venueId = londonVenueIdFor("n0000000001");
    const res = await POST(
      post({ venueId, drinkCategory: "soft-drink", drinkSubtype: LUCIA, priceGbp: 1.79 }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toContain("Pick a venue");
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("refuses a real London venue-layer place that is not a counter", async () => {
    for (const kind of ["cafe", "restaurant", "library"]) {
      const venueId = firstShardIdOfKind(kind);
      const res = await POST(
        post({ venueId, drinkCategory: "soft-drink", drinkSubtype: LUCIA, priceGbp: 1.79 }),
      );
      expect(res.status, kind).toBe(400);
      expect(await readCommunityPrices(venueId)).toEqual([]);
    }
  });

  it("refuses a pint, or any other category, at a counter", async () => {
    for (const drinkCategory of ["beer", "wine", "coffee", "alcohol-free"]) {
      const res = await POST(
        post({ venueId: mcdonalds.id, drinkCategory, drinkSubtype: LUCIA, priceGbp: 4.5 }),
      );
      expect(res.status, drinkCategory).toBe(400);
      expect(((await res.json()) as { error?: string }).error).toBe(FOOD_PLACE_PRICE_REFUSAL);
    }
    expect(await readCommunityPrices(mcdonalds.id)).toEqual([]);
    expect(listVisiblePintDrops(mcdonalds.id)).toEqual([]);
  });

  it("refuses a soft drink that does not say it was a Coke Zero or a Diet Coke", async () => {
    for (const drinkSubtype of ["", "soft-drink-pepsi-max", "soft-drink-zero-sugar-cola", "nonsense"]) {
      const res = await POST(
        post({ venueId: mcdonalds.id, drinkCategory: "soft-drink", drinkSubtype, priceGbp: 1.79 }),
      );
      expect(res.status, drinkSubtype || "(none)").toBe(400);
    }
    expect(await readCommunityPrices(mcdonalds.id)).toEqual([]);
  });

  it("still needs the bill", async () => {
    const form = new FormData();
    form.set("venueId", mcdonalds.id);
    form.set("drinkCategory", "soft-drink");
    form.set("drinkSubtype", LUCIA);
    form.set("priceGbp", "1.79");
    const res = await POST(
      new Request("http://localhost/api/price-submit", { method: "POST", body: form }),
    );
    expect(res.status).toBe(400);
    expect(await readCommunityPrices(mcdonalds.id)).toEqual([]);
  });

  it("still needs a signed-in account", async () => {
    authState.userId = null;
    const res = await POST(
      post({ venueId: mcdonalds.id, drinkCategory: "soft-drink", drinkSubtype: LUCIA, priceGbp: 1.79 }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await readCommunityPrices(mcdonalds.id)).toEqual([]);
  });

  it("spends the same per-venue rate limit as a pub's price (429)", async () => {
    for (let i = 0; i < 9; i += 1) {
      const res = await POST(
        post({
          venueId: mcdonalds.id,
          drinkCategory: "soft-drink",
          drinkSubtype: LUCIA,
          priceGbp: 1.5 + i / 100,
        }),
      );
      expect(res.status, `submission ${i + 1}`).toBe(i < 8 ? 201 : 429);
    }
  });

  it("answers 503 (retryable), never a 400, when the food pack cannot be read", async () => {
    foodIndexState.unavailable = true;
    const res = await POST(
      post({ venueId: mcdonalds.id, drinkCategory: "soft-drink", drinkSubtype: LUCIA, priceGbp: 1.79 }),
    );
    expect(res.status).toBe(503);
    expect(await readCommunityPrices(mcdonalds.id)).toEqual([]);
  });

  it("keeps a counter out of the venue-signal lane", async () => {
    const res = await POST(
      new Request("http://localhost/api/price-submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "venue-signal",
          venueId: mcdonalds.id,
          signalKey: "character",
          signalValue: "posh",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toContain("Pick a venue");
  });
});

describe("GET /api/price-submit at a London fast-food counter", () => {
  it("reads back a counter's price", async () => {
    await POST(
      post({ venueId: mcdonalds.id, drinkCategory: "soft-drink", drinkSubtype: LUCIA, priceGbp: 1.79 }),
    );
    const res = await GET(
      new Request(`http://localhost/api/price-submit?venueId=${encodeURIComponent(mcdonalds.id)}`),
    );
    const body = (await res.json()) as { prices: { priceGbp: number }[] };
    expect(body.prices).toEqual([expect.objectContaining({ priceGbp: 1.79 })]);
  });

  it("is honest-empty for a forged id and degraded when the pack cannot be read", async () => {
    const forged = await GET(
      new Request(`http://localhost/api/price-submit?venueId=${londonVenueIdFor("n0000000001")}`),
    );
    expect(await forged.json()).toEqual({ prices: [] });
    foodIndexState.unavailable = true;
    const degraded = await GET(
      new Request(`http://localhost/api/price-submit?venueId=${encodeURIComponent(mcdonalds.id)}`),
    );
    expect(await degraded.json()).toMatchObject({ prices: [], degraded: true });
  });
});
