import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { durableRead } = vi.hoisted(() => ({
  durableRead: {
    result: { data: null, error: { message: "database unavailable" } } as {
      data: unknown;
      error: { message: string } | null;
    },
    calls: [] as Array<{ method: string; args: unknown[] }>,
  },
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  const query = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return Promise.resolve(durableRead.result).then.bind(
            Promise.resolve(durableRead.result),
          );
        }
        return (...args: unknown[]) => {
          durableRead.calls.push({ method: String(property), args });
          return query;
        };
      },
    },
  );
  return {
    ...actual,
    requireSupabaseAdmin: () => ({
      from: (...args: unknown[]) => {
        durableRead.calls.push({ method: "from", args });
        return query;
      },
      rpc: (...args: unknown[]) => {
        durableRead.calls.push({ method: "rpc", args });
        return query;
      },
    }),
  };
});

import {
  COMMUNITY_PRICE_MAX_AGE_MS,
  SUBMITTABLE_DRINK_CATEGORIES,
} from "@/lib/communityPrice";
import {
  __resetCommunityPrices,
  moderateCommunityPrice,
  readCurrentCommunityPriceActorCoverage,
  submitCommunityPrice,
} from "@/lib/communityPriceStore";

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("current Community Price actor coverage", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    durableRead.result = {
      data: null,
      error: { message: "database unavailable" },
    };
    durableRead.calls.length = 0;
  });

  afterEach(() => {
    __resetCommunityPrices();
    if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  it("returns current categories owned by the requested actor at requested Venues", async () => {
    const now = COMMUNITY_PRICE_MAX_AGE_MS + 20_000;
    await submitCommunityPrice(
      { venueId: "venue-a", drinkCategory: "beer", priceGbp: 4.2, actor: "actor-a" },
      now - 1_000,
    );
    await submitCommunityPrice(
      { venueId: "venue-a", drinkCategory: "wine", priceGbp: 7.8, actor: "actor-a" },
      now - COMMUNITY_PRICE_MAX_AGE_MS - 1,
    );
    const hidden = await submitCommunityPrice(
      {
        venueId: "venue-b",
        drinkCategory: "alcohol-free",
        priceGbp: 4.1,
        actor: "actor-a",
      },
      now - 2_000,
    );
    await submitCommunityPrice(
      { venueId: "venue-a", drinkCategory: "soft-drink", priceGbp: 2.5, actor: "actor-b" },
      now - 3_000,
    );
    await submitCommunityPrice(
      { venueId: "venue-unrequested", drinkCategory: "rum", priceGbp: 6.4, actor: "actor-a" },
      now - 4_000,
    );
    await submitCommunityPrice(
      { venueId: "", drinkCategory: "beer", priceGbp: 4.5, actor: "actor-a" },
      now - 5_000,
    );
    expect(hidden.price?.id).toBeTruthy();
    await moderateCommunityPrice(hidden.price!.id!, true, "not visible");

    const coverage = await readCurrentCommunityPriceActorCoverage(
      ["venue-a", "venue-b", "", "venue-not-logged"],
      "actor-a",
      now,
    );

    expect(coverage).toEqual({
      pairs: [
        { venueId: "venue-a", drinkCategory: "beer" },
        { venueId: "venue-b", drinkCategory: "alcohol-free" },
      ],
      degraded: false,
    });
    expect(Object.keys(coverage.pairs[0] ?? {}).sort()).toEqual([
      "drinkCategory",
      "venueId",
    ]);
  });

  it("fails closed when the requested Venue set exceeds the eight-Venue bound", async () => {
    await submitCommunityPrice(
      { venueId: "venue-1", drinkCategory: "beer", priceGbp: 4.2, actor: "actor-a" },
      1_000,
    );

    await expect(
      readCurrentCommunityPriceActorCoverage(
        Array.from({ length: 9 }, (_, index) => `venue-${index + 1}`),
        "actor-a",
        2_000,
      ),
    ).resolves.toEqual({ pairs: [], degraded: true });
  });

  it("does not treat a non-submittable memory category as mission coverage", async () => {
    await submitCommunityPrice(
      { venueId: "venue-a", drinkCategory: "gin", priceGbp: 8.1, actor: "actor-a" },
      1_000,
    );

    await expect(
      readCurrentCommunityPriceActorCoverage(["venue-a"], "actor-a", 2_000),
    ).resolves.toEqual({ pairs: [], degraded: false });
  });

  it("returns degraded with no pairs when the durable coverage query fails", async () => {
    process.env.SUPABASE_URL = "https://pubmaxx-test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";

    await expect(
      readCurrentCommunityPriceActorCoverage(["venue-a"], "actor-a", 2_000),
    ).resolves.toEqual({ pairs: [], degraded: true });
  });

  it("fails closed when a durable coverage query returns no row array", async () => {
    process.env.SUPABASE_URL = "https://pubmaxx-test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    durableRead.result = { data: null, error: null };

    await expect(
      readCurrentCommunityPriceActorCoverage(["venue-a"], "actor-a", 2_000),
    ).resolves.toEqual({ pairs: [], degraded: true });
  });

  it("fails closed when the durable coverage schema is missing", async () => {
    process.env.SUPABASE_URL = "https://pubmaxx-test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    durableRead.result = {
      data: null,
      error: { message: 'relation "community_prices" does not exist' },
    };

    await expect(
      readCurrentCommunityPriceActorCoverage(["venue-a"], "actor-a", 2_000),
    ).resolves.toEqual({ pairs: [], degraded: true });
  });

  it("keeps the durable read actor-bound, Venue-bounded, current, and minimally projected", async () => {
    process.env.SUPABASE_URL = "https://pubmaxx-test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    const now = COMMUNITY_PRICE_MAX_AGE_MS + 20_000;
    const current = new Date(now - 1_000).toISOString();
    const cutoff = new Date(now - COMMUNITY_PRICE_MAX_AGE_MS).toISOString();
    const stale = new Date(now - COMMUNITY_PRICE_MAX_AGE_MS - 1).toISOString();
    durableRead.result = {
      data: [
        {
          venue_id: "venue-a",
          drink_category: "beer",
          submitted_at: current,
          actor: "actor-a",
          hidden_at: null,
        },
        {
          venue_id: "venue-a",
          drink_category: "wine",
          submitted_at: current,
          actor: "actor-b",
          hidden_at: null,
        },
        {
          venue_id: "venue-unrequested",
          drink_category: "rum",
          submitted_at: current,
          actor: "actor-a",
          hidden_at: null,
        },
        {
          venue_id: "venue-b",
          drink_category: "gin",
          submitted_at: current,
          actor: "actor-a",
          hidden_at: null,
        },
        {
          venue_id: "venue-b",
          drink_category: "alcohol-free",
          submitted_at: cutoff,
          actor: "actor-a",
          hidden_at: null,
        },
        {
          venue_id: "venue-b",
          drink_category: "cocktail",
          submitted_at: current,
          actor: "actor-a",
          hidden_at: current,
        },
        {
          venue_id: "venue-b",
          drink_category: "coffee",
          submitted_at: stale,
          actor: "actor-a",
          hidden_at: null,
        },
        {
          venue_id: "venue-b",
          drink_category: "not-a-drink",
          submitted_at: current,
          actor: "actor-a",
          hidden_at: null,
        },
      ],
      error: null,
    };

    await expect(
      readCurrentCommunityPriceActorCoverage(
        ["venue-a", "venue-b"],
        "actor-a",
        now,
      ),
    ).resolves.toEqual({
      pairs: [
        { venueId: "venue-a", drinkCategory: "beer" },
        { venueId: "venue-b", drinkCategory: "alcohol-free" },
        { venueId: "venue-b", drinkCategory: "cocktail" },
      ],
      degraded: false,
    });

    expect(durableRead.calls).toContainEqual({
      method: "from",
      args: ["community_prices"],
    });
    expect(durableRead.calls).toContainEqual({
      method: "select",
      args: ["venue_id, drink_category, submitted_at, actor"],
    });
    expect(durableRead.calls).toContainEqual({
      method: "eq",
      args: ["actor", "actor-a"],
    });
    expect(durableRead.calls).toContainEqual({
      method: "in",
      args: ["venue_id", ["venue-a", "venue-b"]],
    });
    expect(durableRead.calls).toContainEqual({
      method: "in",
      args: ["drink_category", [...SUBMITTABLE_DRINK_CATEGORIES]],
    });
    expect(durableRead.calls).not.toContainEqual({
      method: "is",
      args: ["hidden_at", null],
    });
    expect(durableRead.calls).toContainEqual({
      method: "gte",
      args: ["submitted_at", cutoff],
    });
    expect(durableRead.calls).toContainEqual({
      method: "limit",
      args: [8 * SUBMITTABLE_DRINK_CATEGORIES.length],
    });
  });

  it("returns every pair at the full eight-Venue submittable-category cap", async () => {
    process.env.SUPABASE_URL = "https://pubmaxx-test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    const now = COMMUNITY_PRICE_MAX_AGE_MS + 20_000;
    const submittedAt = new Date(now - 1_000).toISOString();
    const venueIds = Array.from({ length: 8 }, (_, index) => `venue-${index + 1}`);
    const rows = venueIds.flatMap((venueId) =>
      SUBMITTABLE_DRINK_CATEGORIES.map((drinkCategory) => ({
        venue_id: venueId,
        drink_category: drinkCategory,
        submitted_at: submittedAt,
        actor: "actor-a",
      })),
    );
    durableRead.result = { data: rows, error: null };

    const coverage = await readCurrentCommunityPriceActorCoverage(
      venueIds,
      "actor-a",
      now,
    );

    expect(coverage.degraded).toBe(false);
    expect(coverage.pairs).toHaveLength(64);
    expect(new Set(
      coverage.pairs.map((pair) => `${pair.venueId}:${pair.drinkCategory}`),
    )).toEqual(new Set(
      rows.map((row) => `${row.venue_id}:${row.drink_category}`),
    ));
    expect(durableRead.calls).toContainEqual({
      method: "limit",
      args: [64],
    });
  });
});
