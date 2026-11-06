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
  pintData: [] as unknown[] | null,
  pintCount: 0 as number | null,
  pintError: null as { message: string } | null,
  pintCalls: [] as unknown[][],
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => durable.enabled,
    requiresSupabaseStore: () => false,
    requireSupabaseAdmin: () => ({ from: (table: string) => {
      const pint = table === "pint_drops";
      const calls = pint ? durable.pintCalls : durable.calls;
      calls.push(["from", table]);
      const query = {
        select: (...args: unknown[]) => { calls.push(["select", ...args]); return query; },
        eq: (...args: unknown[]) => { calls.push(["eq", ...args]); return query; },
        in: (...args: unknown[]) => { calls.push(["in", ...args]); return query; },
        not: (...args: unknown[]) => { calls.push(["not", ...args]); return query; },
        gte: (...args: unknown[]) => { calls.push(["gte", ...args]); return query; },
        limit: async (limit: number) => {
          calls.push(["limit", limit]);
          return pint
            ? { data: durable.pintData, count: durable.pintCount, error: durable.pintError }
            : { data: durable.data, count: durable.count, error: durable.error };
        },
      };
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
import { __resetPintDrops, addPintDrop, validatePintDrop } from "@/lib/pintDrops";
import { pintDropAuthorityKey } from "@/lib/pintDropAuthority.server";
import { MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS } from "@/lib/priceEvidenceMissions";
import { resetVenueAliasesForTests, setVenueAliasesPathForTests } from "@/lib/venueAliases";

const NOW = Date.parse("2026-08-16T18:00:00.000Z");
const ACTOR = "profile:coverage-owner";
const ACCOUNT_ID = "account-coverage-owner";
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

function pintRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    venue_id: "venue-current",
    authority_key: pintDropAuthorityKey("venue-current", ACCOUNT_ID),
    price_gbp: 4.2,
    created_at: new Date(NOW).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  durable.enabled = false;
  durable.data = [];
  durable.count = 0;
  durable.error = null;
  durable.calls = [];
  durable.pintData = [];
  durable.pintCount = 0;
  durable.pintError = null;
  durable.pintCalls = [];
  __resetPintDrops();
  __resetCommunityPrices();
});

afterEach(async () => {
  resetVenueAliasesForTests();
  __resetCommunityPrices();
  __resetPintDrops();
  if (aliasDirectory) await fs.rm(aliasDirectory, { recursive: true, force: true });
  aliasDirectory = undefined;
});

describe("current mission actor coverage", () => {
  it.each(["public", "anonymous", "friends", "legacy"] as const)("covers hidden Pint Drops under former IDs: %s", async (visibility) => {
    await installAliases();
    const result = validatePintDrop({
      venueId: "venue-former", handle: "coverage_owner", drink: "Lager", priceGbp: 4.2,
    });
    if (!result.ok) throw new Error(result.error);
    addPintDrop({
      ...result.value, status: "hidden", visibility,
      createdAt: new Date(NOW - COMMUNITY_PRICE_MAX_AGE_MS).toISOString(),
      authorityKey: pintDropAuthorityKey("venue-former", ACCOUNT_ID),
    });

    await expect(readCurrentCommunityPriceActorCoverage(["venue-current", "venue-former"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({
      pairs: [
        { venueId: "venue-current", drinkCategory: "beer" },
        { venueId: "venue-former", drinkCategory: "beer" },
      ], degraded: false,
    });
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], "profile:other", "other-account", NOW)).resolves.toEqual({
      pairs: [], degraded: false,
    });
  });

  it("merges durable Pint Drop beer coverage with other Community Price categories", async () => {
    await installAliases();
    durable.enabled = true;
    durable.data = [durableRow(), durableRow({ drink_category: "wine" })];
    durable.count = 2;
    durable.pintData = [pintRow({ venue_id: "venue-former", authority_key: pintDropAuthorityKey("venue-former", ACCOUNT_ID) })];
    durable.pintCount = 1;

    await expect(readCurrentCommunityPriceActorCoverage(["venue-current", "venue-former"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({
      pairs: [
        { venueId: "venue-current", drinkCategory: "beer" },
        { venueId: "venue-current", drinkCategory: "wine" },
        { venueId: "venue-former", drinkCategory: "beer" },
        { venueId: "venue-former", drinkCategory: "wine" },
      ], degraded: false,
    });
    expect(durable.pintCalls).toEqual([
      ["from", "pint_drops"],
      ["select", "venue_id, authority_key, price_gbp, created_at", { count: "exact" }],
      ["in", "venue_id", ["venue-current", "venue-former"]],
      ["in", "authority_key", [pintDropAuthorityKey("venue-current", ACCOUNT_ID), pintDropAuthorityKey("venue-former", ACCOUNT_ID)]],
      ["not", "price_gbp", "is", null],
      ["gte", "created_at", new Date(NOW - COMMUNITY_PRICE_MAX_AGE_MS).toISOString()],
      ["limit", 200],
    ]);
  });

  it("counts a durable Pint Drop without any Community Price rows", async () => {
    durable.enabled = true;
    durable.pintData = [pintRow()];
    durable.pintCount = 1;
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({
      pairs: [{ venueId: "venue-current", drinkCategory: "beer" }], degraded: false,
    });
  });

  it.each([
    { data: null, count: null, error: { message: "database unavailable" } },
    { data: null, count: null, error: { message: 'relation "public.pint_drops" does not exist' } },
    { data: [], count: null, error: null },
    { data: [], count: 201, error: null },
    { data: [], count: 1, error: null },
  ])("rejects failed or incomplete Pint Drop reads: %j", async ({ data, count, error }) => {
    durable.enabled = true;
    durable.data = [durableRow()];
    durable.count = 1;
    durable.pintData = data;
    durable.pintCount = count;
    durable.pintError = error;
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({ pairs: [], degraded: true });
  });

  it.each([
    { authority_key: "another-account-key" },
    { venue_id: "venue-offscreen" },
    { price_gbp: null },
    { created_at: "invalid" },
    { created_at: new Date(NOW - COMMUNITY_PRICE_MAX_AGE_MS - 1).toISOString() },
  ])("rejects malformed or out-of-scope Pint Drop rows: %j", async (overrides) => {
    durable.enabled = true;
    durable.pintData = [pintRow(overrides)];
    durable.pintCount = 1;
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({ pairs: [], degraded: true });
  });

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

    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({
      pairs: [{ venueId: "venue-current", drinkCategory: "beer" }], degraded: false,
    });
  });

  it("projects memory coverage onto both requested canonical and former IDs", async () => {
    await installAliases();
    await submitCommunityPrice({
      venueId: "venue-former", drinkCategory: "beer", priceGbp: 4.2, actor: ACTOR,
    }, NOW - COMMUNITY_PRICE_MAX_AGE_MS);

    await expect(readCurrentCommunityPriceActorCoverage(["venue-current", "venue-former"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({
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
    await expect(readCurrentCommunityPriceActorCoverage(ids, ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({ pairs: [], degraded: true });
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], "", ACCOUNT_ID, NOW)).resolves.toEqual({ pairs: [], degraded: true });
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, "", NOW)).resolves.toEqual({ pairs: [], degraded: true });
    expect(durable.calls).toEqual([]);
    expect(durable.pintCalls).toEqual([]);
  });

  it("uses bounded actor-scoped durable reads and canonicalizes aliases", async () => {
    await installAliases();
    durable.enabled = true;
    durable.data = [durableRow(), durableRow({ venue_id: "venue-former" })];
    durable.count = 2;

    await expect(readCurrentCommunityPriceActorCoverage(["venue-current", "venue-former"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({
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
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({ pairs: [], degraded: false });
    durable.count = 201;
    durable.data = [durableRow()];
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({ pairs: [], degraded: true });
    durable.count = null;
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({ pairs: [], degraded: true });
    durable.error = { message: "database unavailable" };
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({ pairs: [], degraded: true });
  });

  it("does not replace a missing durable table with process-memory coverage", async () => {
    await submitCommunityPrice({
      venueId: "venue-current", drinkCategory: "beer", priceGbp: 4.2, actor: ACTOR,
    }, NOW);
    durable.enabled = true;
    durable.error = { message: 'relation "public.community_prices" does not exist' };
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({
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
    await expect(readCurrentCommunityPriceActorCoverage(["venue-current"], ACTOR, ACCOUNT_ID, NOW)).resolves.toEqual({ pairs: [], degraded: true });
  });
});
