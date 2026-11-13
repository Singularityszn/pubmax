import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getPintDropById is the single leak-proof permalink read (/p/[id] + its OG
// card). It has two paths chosen by isSupabaseConfigured(): a Supabase read that
// names ONLY public columns, and a memory fallback over the in-memory store plus
// the demo seeds when demo content is on. We exercise the memory path here.
//
// FORCE the memory path: on Vercel vitest runs with the project's env set — if
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are present, isSupabaseConfigured()
// would be true and the read would try to hit the network (and fail only in CI).
// Clearing them in beforeEach pins the lookup to its memory fallback everywhere,
// which resolves demo-seeded drops from the bundled dataset — deterministic and
// offline.
import { getPintDropById } from "@/lib/pintDropLookup";
import { demoPintDrops } from "@/lib/pintDropSeeds";
import { getVenueIndex } from "@/lib/venueIndex";
import * as supabase from "@/lib/supabase";
import * as publicAccess from "@/lib/accountPublicAccess.server";
import * as avatars from "@/lib/avatarResolve";
import { ANON_HANDLE_LABEL } from "@/lib/pintDropShared";
import { defined } from "@/__tests__/helpers/defined";

// A real demo seed that always rides the in-memory read path. Its venueId
// resolves to a curated heritage pub in the bundled dataset, so enrichment
// produces a real venue NAME (not the friendly fallback).
const SEED = defined(demoPintDrops[0]);

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Demo content is opt-in, and these cases read a seed by id. The switch
  // itself is covered in __tests__/pintDropLookupDemoOptIn.test.ts.
  process.env.NEXT_PUBLIC_DEMO_CONTENT = "on";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_DEMO_CONTENT;
});

describe("getPintDropById — resolves a known visible drop (memory path)", () => {
  it("returns the seed drop enriched with a real venue name + map link", async () => {
    const index = await getVenueIndex();
    const expectedName = index.get(SEED.venueId)?.name;
    expect(expectedName, "dataset must resolve the seed venue").toBeTruthy();

    const drop = await getPintDropById(SEED.id);
    expect(drop).not.toBeNull();
    expect(drop!.id).toBe(SEED.id);
    expect(drop!.venueId).toBe(SEED.venueId);
    // Enrichment: the raw id becomes a real pub NAME + a map link, never the id.
    expect(drop!.venueName).toBe(expectedName);
    expect(drop!.venueName).not.toBe("A London pub");
    expect(drop!.venueName).not.toMatch(/^venue-/);
    expect(drop!.venueMapUrl).toBe(`/map?sel=${encodeURIComponent(SEED.venueId)}`);
    // Content the permalink renders rides through faithfully.
    expect(drop!.handle).toBe(SEED.handle);
    expect(drop!.note).toBe(SEED.passedDownNote);
    expect(drop!.priceGbp).toBe(SEED.priceGbp);
    // The memory store has no Storage, so no photo URLs.
    expect(drop!.pintPhotoUrl).toBeNull();
    expect(drop!.venuePhotoUrl).toBeNull();
  });

  it("trims a padded id before resolving it", async () => {
    const drop = await getPintDropById(`   ${SEED.id}   `);
    expect(drop).not.toBeNull();
    expect(drop!.id).toBe(SEED.id);
  });
});

describe("getPintDropById — unknown / empty ids resolve to null (never throw)", () => {
  it("returns null for an unknown id", async () => {
    expect(await getPintDropById("does-not-exist")).toBeNull();
  });

  it("returns null for an empty / whitespace / non-string id", async () => {
    expect(await getPintDropById("")).toBeNull();
    expect(await getPintDropById("   ")).toBeNull();
    // A non-string id is coerced to "" and short-circuits to null, never throws.
    expect(await getPintDropById(undefined as unknown as string)).toBeNull();
    expect(await getPintDropById(null as unknown as string)).toBeNull();
    expect(await getPintDropById(123 as unknown as string)).toBeNull();
  });
});

describe("PublicDrop DTO — leak-proof by column selection", () => {
  it("carries NO report_*/moderator_*/status/actor_hash/photo-key fields", async () => {
    const drop = await getPintDropById(SEED.id);
    expect(drop).not.toBeNull();

    const forbidden = [
      "status",
      "actor_hash",
      "actorHash",
      "reportCount",
      "reportReason",
      "reportedAt",
      "moderatorNote",
      "moderatedAt",
      "pintPhotoKey",
      "venuePhotoKey",
      "pint_photo_key",
      "venue_photo_key",
    ];
    for (const key of forbidden) expect(drop).not.toHaveProperty(key);

    // The DTO exposes exactly the sanctioned public surface — nothing more.
    expect(Object.keys(drop!).sort()).toEqual(
      [
        "createdAt",
        "drink",
        "era",
        "handle",
        "id",
        "note",
        "pintPhotoUrl",
        "priceGbp",
        "provenance",
        "venueId",
        "venueMapUrl",
        "venueName",
        "venuePhotoUrl",
        "vibeTags",
        "visibility",
      ].sort(),
    );

    // No moderation trail leaks even when serialized.
    const serialized = JSON.stringify(drop);
    expect(serialized).not.toContain("report");
    expect(serialized).not.toContain("moderat");
    expect(serialized).not.toContain("photo_key");
  });

  it("normalizes vibeTags to an array (never undefined) on a tagless seed", async () => {
    const drop = await getPintDropById(SEED.id);
    expect(Array.isArray(drop!.vibeTags)).toBe(true);
  });
});

describe("getPintDropById with optional database columns", () => {
  const stored = {
    id: "receipt-database-drop",
    venue_id: SEED.venueId,
    handle: "receipt_author",
    drink: "Guinness",
    measure: "pint",
    measure_label: null,
    price_gbp: 4.7,
    price_evidence: "unchecked",
    passed_down_note: "",
    era: "",
    provenance: "contributor",
    created_at: "2026-11-10T21:14:00.000Z",
    vibe_tags: [],
    visibility: "public",
    status: "visible",
    pint_photo_key: null,
    venue_photo_key: null,
    author_retired_at: null,
  };

  function database(
    missing: string[],
    overrides: Record<string, unknown> = {},
    code = "42703",
  ) {
    const row: Record<string, unknown> = { ...stored, ...overrides };
    const admin = {
      from: () => ({
        select: (selection: string) => {
          const columns = selection.split(",");
          const filters = new Map<string, unknown>();
          const query = {
            eq(column: string, value: unknown) {
              filters.set(column, value);
              return this;
            },
            maybeSingle: async () => {
              const absent = columns.find((column) => missing.includes(column));
              if (absent) {
                return { data: null, error: { code, message: `column pint_drops.${absent} does not exist` } };
              }
              const matches = [...filters].every(([column, value]) => row[column] === value);
              return {
                data: matches ? Object.fromEntries(columns.map((column) => [column, row[column]])) : null,
                error: null,
              };
            },
          };
          return query;
        },
      }),
    };
    vi.spyOn(supabase, "isSupabaseConfigured").mockReturnValue(true);
    vi.spyOn(supabase, "getSupabaseAdmin").mockReturnValue(
      admin as unknown as NonNullable<ReturnType<typeof supabase.getSupabaseAdmin>>,
    );
    vi.spyOn(publicAccess, "withdrawnHandles").mockResolvedValue(new Set<string>());
    vi.spyOn(avatars, "resolveAvatarUrlsForHandles").mockResolvedValue(new Map<string, string>());
  }

  afterEach(() => vi.restoreAllMocks());

  it.each(["public", "anonymous"])("keeps per-drop %s stars behind the permalink gate", async (visibility) => {
    database([], { rating: 4, visibility });
    expect(await getPintDropById(stored.id)).toMatchObject({
      id: stored.id, rating: 4, handle: visibility === "anonymous" ? ANON_HANDLE_LABEL : "receipt_author",
    });
  });

  it.each(["friends", "legacy"])("withholds %s stars from a stranger", async (visibility) => {
    database([], { rating: 4, visibility });
    expect(await getPintDropById(stored.id)).toBeNull();
  });

  it.each(["42703", "PGRST204"])("keeps the permalink available without the rating column (%s)", async (code) => {
    database(["rating"], {}, code);
    const drop = await getPintDropById(stored.id);
    expect(drop).toMatchObject({ id: stored.id, priceGbp: 4.7 });
    expect(drop).not.toHaveProperty("rating");
  });

  it("keeps the stated serving and evidence on a current database", async () => {
    database([], { measure: "half", price_gbp: 2.35 });
    expect(await getPintDropById(stored.id)).toMatchObject({
      id: stored.id, measure: "half", priceGbp: 2.35, priceEvidence: "unchecked", handle: "receipt_author",
    });
  });

  it("keeps serving and evidence when only retirement is unavailable", async () => {
    database(["author_retired_at"], { measure: "half", price_gbp: 2.35 });
    expect(await getPintDropById(stored.id)).toMatchObject({
      id: stored.id, measure: "half", priceGbp: 2.35, priceEvidence: "unchecked", handle: "receipt_author",
    });
  });

  it.each(["42703", "PGRST204"])("resolves old schemas after %s missing-column errors", async (code) => {
    database(["measure", "measure_label", "price_evidence", "author_retired_at"], {}, code);
    const drop = await getPintDropById(stored.id);
    expect(drop).toMatchObject({
      id: stored.id, priceGbp: 4.7, handle: "receipt_author", createdAt: stored.created_at,
    });
    expect(drop).not.toHaveProperty("measure");
    expect(drop).not.toHaveProperty("measureLabel");
    expect(drop).not.toHaveProperty("priceEvidence");
  });

  it.each(["measure", "measure_label", "price_evidence"])("preserves retired anonymity without %s", async (column) => {
    database([column], { author_retired_at: "2026-11-11T00:00:00.000Z" });
    expect(await getPintDropById(stored.id)).toMatchObject({ id: stored.id, handle: ANON_HANDLE_LABEL });
  });

  it("keeps a non-pint measure when only price evidence is unavailable", async () => {
    database(["price_evidence"], { measure: "half", price_gbp: 2.35 });
    const drop = await getPintDropById(stored.id);
    expect(drop).toMatchObject({ measure: "half", priceGbp: 2.35 });
    expect(drop).not.toHaveProperty("priceEvidence");
  });

  it.each(["hidden", "pending"])("still refuses a %s drop after fallback", async (status) => {
    database(["price_evidence"], { status });
    expect(await getPintDropById(stored.id)).toBeNull();
  });

  it.each(["friends", "legacy"])("still refuses a stranger's %s drop after fallback", async (visibility) => {
    database(["price_evidence"], { visibility });
    expect(await getPintDropById(stored.id)).toBeNull();
  });

  it.each(["friends", "legacy"])("still permits the author of a %s drop after fallback", async (visibility) => {
    database(["price_evidence"], { visibility });
    expect(await getPintDropById(stored.id, { handle: "receipt_author" })).toMatchObject({ id: stored.id });
  });

  it("keeps anonymous authors withheld after fallback", async () => {
    database(["price_evidence"], { visibility: "anonymous" });
    expect(await getPintDropById(stored.id)).toMatchObject({ id: stored.id, handle: ANON_HANDLE_LABEL });
  });

  it("does not treat other database failures as missing columns", async () => {
    database(["price_evidence"], {}, "42501");
    expect(await getPintDropById(stored.id)).toBeNull();
  });
});
