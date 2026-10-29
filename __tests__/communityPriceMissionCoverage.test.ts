import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const durable = vi.hoisted(() => ({
  enabled: false,
  data: [] as unknown[],
  count: 0 as number | null,
  error: null as { message: string } | null,
  calls: [] as unknown[][],
}));

vi.mock("@/lib/supabase", () => {
  const query = {
    select: (...args: unknown[]) => { durable.calls.push(["select", ...args]); return query; },
    eq: (...args: unknown[]) => { durable.calls.push(["eq", ...args]); return query; },
    in: (...args: unknown[]) => { durable.calls.push(["in", ...args]); return query; },
    gte: (...args: unknown[]) => { durable.calls.push(["gte", ...args]); return query; },
    limit: async (limit: number) => {
      durable.calls.push(["limit", limit]);
      return { data: durable.data, count: durable.count, error: durable.error };
    },
  };
  return {
    isSupabaseConfigured: () => durable.enabled,
    requiresSupabaseStore: () => false,
    requireSupabaseAdmin: () => ({ from: (table: string) => {
      durable.calls.push(["from", table]);
      return query;
    } }),
  };
});

import { COMMUNITY_PRICE_MAX_AGE_MS, SUBMITTABLE_DRINK_CATEGORIES } from "@/lib/communityPrice";
import {
  __resetCommunityPrices,
  moderateCommunityPrice,
  readCurrentCommunityPriceActorCoverage,
  submitCommunityPrice,
} from "@/lib/communityPriceStore";
import { MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS } from "@/lib/priceEvidenceMissions";
import { resetVenueAliasesForTests, setVenueAliasesPathForTests } from "@/lib/venueAliases";

const NOW = Date.parse("2026-08-16T18:00:00.000Z");
const ACTOR = "profile:coverage-owner";
let aliasDirectory: string | undefined;

async function installAliases(): Promise<void> {
  aliasDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mission-coverage-aliases-"));
  const file = path.join(aliasDirectory, "aliases.json");
  await fs.writeFile(file, JSON.stringify({ aliases: { "venue-former": "venue-current" } }));
  setVenueAliasesPathForTests(file);
}

function durableRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    venue_id: "venue-current",
    drink_category: "beer",
    submitted_at: new Date(NOW).toISOString(),
    actor: ACTOR,
    ...overrides,
  };
}

beforeEach(() => {
  durable.enabled = false;
  durable.data = [];
  durable.count = 0;
  durable.error = null;
  durable.calls = [];
  __resetCommunityPrices();
});

afterEach(async () => {
  resetVenueAliasesForTests();
  __resetCommunityPrices();
  if (aliasDirectory) await fs.rm(aliasDirectory, { recursive: true, force: true });
  aliasDirectory = undefined;
});

describe("current mission actor coverage", () => {
  it("includes hidden own rows but excludes stale, other-actor and offscreen rows", async () => {
    const { price } = await submitCommunityPrice({
      venueId: "venue-current", drinkCategory: "beer", priceGbp: 4.2, actor: ACTOR,
    }, NOW);
    if (!price?.id) throw new Error("Expected a stored observation.");
    await moderateCommunityPrice(price.id, true, "menu mismatch");
    await submitCommunityPrice({
      venueId: "venue-current", drinkCategory: "wine", priceGbp: 5.5, actor: ACTOR,
    }, NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1);
    await submitCommunityPrice({
      venueId: "venue-current", drinkCategory: "coffee", priceGbp: 3.5, actor: "profile:another",
    }, NOW);
    await submitCommunityPrice({
      venueId: "venue-offscreen", drinkCategory: "beer", priceGbp: 4.2, actor: ACTOR,
    }, NOW);

    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, NOW)).resolves.toEqual({
      pairs: [{ venueId: "venue-current", drinkCategory: "beer" }], degraded: false,
    });
  });

  it("projects memory coverage onto both requested canonical and former IDs", async () => {
    await installAliases();
    await submitCommunityPrice({
      venueId: "venue-former", drinkCategory: "beer", priceGbp: 4.2, actor: ACTOR,
    }, NOW - COMMUNITY_PRICE_MAX_AGE_MS);

    await expect(readCurrentCommunityPriceActorCoverage(["venue-current", "venue-former"], ACTOR, NOW)).resolves.toEqual({
      pairs: [
        { venueId: "venue-current", drinkCategory: "beer" },
        { venueId: "venue-former", drinkCategory: "beer" },
      ],
      degraded: false,
    });
  });

  it("bounds requests before issuing a durable query", async () => {
    durable.enabled = true;
    const ids = Array.from({ length: MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS + 1 }, (_, index) => `venue-${index}`);
    await expect(readCurrentCommunityPriceActorCoverage(ids, ACTOR, NOW)).resolves.toEqual({ pairs: [], degraded: true });
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], "", NOW)).resolves.toEqual({ pairs: [], degraded: true });
    expect(durable.calls).toEqual([]);
  });

  it("uses one bounded actor-scoped durable read and canonicalizes its aliases", async () => {
    await installAliases();
    durable.enabled = true;
    durable.data = [durableRow(), durableRow({ venue_id: "venue-former" })];
    durable.count = 2;

    await expect(readCurrentCommunityPriceActorCoverage(["venue-current", "venue-former"], ACTOR, NOW)).resolves.toEqual({
      pairs: [
        { venueId: "venue-current", drinkCategory: "beer" },
        { venueId: "venue-former", drinkCategory: "beer" },
      ], degraded: false,
    });
    expect(durable.calls).toEqual([
      ["from", "community_prices"],
      ["select", "venue_id, drink_category, submitted_at, actor", { count: "exact" }],
      ["eq", "actor", ACTOR],
      ["in", "venue_id", ["venue-current", "venue-former"]],
      ["in", "drink_category", [...SUBMITTABLE_DRINK_CATEGORIES]],
      ["gte", "submitted_at", new Date(NOW - COMMUNITY_PRICE_MAX_AGE_MS).toISOString()],
      ["limit", 200],
    ]);
  });

  it("distinguishes an honest durable empty from incomplete reads", async () => {
    durable.enabled = true;
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, NOW)).resolves.toEqual({ pairs: [], degraded: false });
    durable.count = 201;
    durable.data = [durableRow()];
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, NOW)).resolves.toEqual({ pairs: [], degraded: true });
    durable.count = null;
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, NOW)).resolves.toEqual({ pairs: [], degraded: true });
    durable.error = { message: "database unavailable" };
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, NOW)).resolves.toEqual({ pairs: [], degraded: true });
  });

  it("does not replace a missing durable table with process-memory coverage", async () => {
    await submitCommunityPrice({
      venueId: "venue-current", drinkCategory: "beer", priceGbp: 4.2, actor: ACTOR,
    }, NOW);
    durable.enabled = true;
    durable.error = { message: 'relation "public.community_prices" does not exist' };
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, NOW)).resolves.toEqual({
      pairs: [], degraded: true,
    });
  });

  it.each([
    { actor: "profile:another" },
    { venue_id: "venue-offscreen" },
    { drink_category: null },
    { submitted_at: "invalid" },
    { submitted_at: new Date(NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1).toISOString() },
  ])("rejects malformed or out-of-scope durable coverage: %j", async (overrides) => {
    durable.enabled = true;
    durable.data = [durableRow(overrides)];
    durable.count = 1;
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, NOW)).resolves.toEqual({ pairs: [], degraded: true });
  });
});
