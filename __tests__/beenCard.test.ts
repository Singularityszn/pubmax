import type { ReactNode } from "react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Been card: a share link exists only once the owner's Been list holds
// enough pubs, carries a count the server signed itself, and shows a pint
// only while it is the owner's own public, priced pint.

import { beenCardUnlocked, beenCardLockedLine, cheapestBeenCardDrop, type BeenCardDrop } from "@/lib/beenCard";
import { mintOwnBeenCardShare, type BeenCardMintDeps } from "@/lib/beenCardMint.server";
import {
  mintBeenCardShare,
  readBeenCard,
  verifyBeenCardShare,
  type BeenCardReadDeps,
} from "@/lib/beenCardShare.server";
import type { PublicDrop } from "@/lib/pintDropLookup";

const database = vi.hoisted(() => ({
  drops: [] as Record<string, unknown>[],
  aliases: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/storeBackend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storeBackend")>();
  return {
    ...actual,
    admin: () => ({
      from(table: string) {
        let rows = [...(table === "profile_handle_aliases" ? database.aliases : database.drops)];
        const ordering: { field: string; ascending: boolean }[] = [];
        let limit = Infinity;
        const query: Record<string, unknown> = {
          select: () => query,
          eq(field: string, value: unknown) {
            rows = rows.filter((row) => row[field] === value);
            return query;
          },
          in(field: string, values: unknown[]) {
            rows = rows.filter((row) => values.includes(row[field]));
            return query;
          },
          is(field: string, value: null) {
            rows = rows.filter((row) => (row[field] ?? null) === value);
            return query;
          },
          gt(field: string, value: number) {
            rows = rows.filter((row) => {
              const held = row[field];
              return typeof held === "number" && held > value;
            });
            return query;
          },
          order(field: string, options: { ascending: boolean }) {
            ordering.push({ field, ascending: options.ascending });
            return query;
          },
          limit(value: number) { limit = value; return query; },
          then(resolve: (result: { data: Record<string, unknown>[]; error: null }) => unknown) {
            rows.sort((a, b) => {
              for (const { field, ascending } of ordering) {
                const left = a[field] as number | string;
                const right = b[field] as number | string;
                if (left !== right) return (left < right ? -1 : 1) * (ascending ? 1 : -1);
              }
              return 0;
            });
            return Promise.resolve({ data: rows.slice(0, limit), error: null }).then(resolve);
          },
        };
        return query;
      },
    }),
  };
});

vi.mock("next/og", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return {
    ImageResponse: class extends Response {
      constructor(element: ReactNode, options: ResponseInit) {
        super(renderToStaticMarkup(element), options);
      }
    },
  };
});

vi.mock("@/lib/ogBrand", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ogBrand")>();
  return { ...actual, loadOgFonts: () => [] };
});

import BeenImage from "@/app/u/[handle]/been/[token]/opengraph-image";
import { __resetMemoryIdentityHandles, identityHandleStore } from "@/lib/identityHandleStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile, __tombstoneMemoryProfile } from "@/lib/profileStore";
import { __resetMemoryProfileWithdrawals, __setMemoryProfileWithdrawn } from "@/lib/accountPublicAccess.server";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import { memoryPintDropStore, supabasePintDropStore } from "@/lib/pintDropsStore";

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", "off");
});

afterEach(() => {
  __resetMemoryIdentityHandles();
  __resetMemoryProfiles();
  __resetMemoryProfileWithdrawals();
  __resetPintDrops();
  database.drops = [];
  database.aliases = [];
  vi.unstubAllEnvs();
});

function storedDrop(overrides: Partial<PintDrop> & { id: string }): PintDrop {
  return {
    venueId: "venue-1", handle: "sam", priceGbp: 5, measure: "pint", visibility: "public",
    status: "visible", drink: "Guinness", passedDownNote: "", era: "", provenance: "contributor",
    createdAt: "2026-11-10T20:00:00.000Z", ...overrides,
  };
}

function saveDrops(drops: PintDrop[]) {
  __resetPintDrops();
  for (const item of drops) addPintDrop(item);
  database.drops = drops.map((item) => ({
    id: item.id, venue_id: item.venueId, handle: item.handle, price_gbp: item.priceGbp,
    measure: item.measure, visibility: item.visibility, status: item.status,
    created_at: item.createdAt, author_retired_at: item.authorRetiredAt ?? null,
  }));
}

function drop(overrides: Partial<BeenCardDrop> & { id: string }): BeenCardDrop {
  return {
    handle: "sam",
    priceGbp: 5,
    measure: "pint",
    visibility: "public",
    status: "visible",
    createdAt: "2026-11-01T20:00:00.000Z",
    ...overrides,
  };
}

describe("the cheapest pint", () => {
  it("is the owner's own public priced pint, never a half, a hidden, anonymous or friends drop", () => {
    const drops = [
      drop({ id: "half", priceGbp: 2, measure: "half" }),
      drop({ id: "anon", priceGbp: 2.1, visibility: "anonymous" }),
      drop({ id: "friends", priceGbp: 2.2, visibility: "friends" }),
      drop({ id: "hidden", priceGbp: 2.3, status: "hidden" }),
      drop({ id: "unpriced", priceGbp: null }),
      drop({ id: "someone-else", priceGbp: 2.4, handle: "alex" }),
      drop({ id: "dear", priceGbp: 6.2 }),
      drop({ id: "cheap", priceGbp: 4.1 }),
    ];
    expect(cheapestBeenCardDrop(drops, "@Sam")?.id).toBe("cheap");
    expect(cheapestBeenCardDrop(drops.slice(0, 6), "sam")).toBeNull();
  });

  it("takes the newest of two pints at the same price", () => {
    const drops = [
      drop({ id: "older", priceGbp: 4, createdAt: "2026-10-01T20:00:00.000Z" }),
      drop({ id: "newer", priceGbp: 4, createdAt: "2026-11-01T20:00:00.000Z" }),
    ];
    expect(cheapestBeenCardDrop(drops, "sam")?.id).toBe("newer");
  });
});

describe("the lock", () => {
  it("counts down to the unlock and then gets out of the way", () => {
    expect(beenCardLockedLine(4)).toBe("1 more pub and you can share your Been card.");
    expect(beenCardLockedLine(2)).toBe("3 more pubs and you can share your Been card.");
    expect(beenCardLockedLine(5)).toBeNull();
    expect(beenCardUnlocked(4)).toBe(false);
    expect(beenCardUnlocked(5)).toBe(true);
  });
});

describe("the signed link", () => {
  it("round-trips for its own handle and nobody else's", () => {
    const token = mintBeenCardShare("sam", 12, "drop-1", 1_000);
    expect(verifyBeenCardShare(token, "@Sam")).toEqual({ handle: "sam", pubs: 12, dropId: "drop-1", issuedAt: 1_000 });
    expect(verifyBeenCardShare(token, "alex")).toBeNull();
  });

  it("refuses a count somebody typed into the link", () => {
    const [encoded, signature] = mintBeenCardShare("sam", 12, null, 1_000).split(".");
    const claims = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8"));
    const forged = Buffer.from(JSON.stringify({ ...claims, n: 900 }), "utf8").toString("base64url");
    expect(verifyBeenCardShare(`${forged}.${signature}`, "sam")).toBeNull();
  });

  it("will not sign four pubs and signs five pubs", () => {
    expect(() => mintBeenCardShare("sam", 4, null)).toThrow();
    expect(verifyBeenCardShare(mintBeenCardShare("sam", 5, null), "sam")?.pubs).toBe(5);
  });
});

describe("the owner's mint", () => {
  const request = new Request("https://pubmaxxing.com/api/profiles/sam/been-card");

  function deps(count: number | null, caller: string | null = "user-sam", drops: BeenCardDrop[] = []): BeenCardMintDeps {
    return {
      verifyCaller: async () => caller,
      profile: async (handle) => (handle === "sam" ? { userId: "user-sam", tombstoned: false } : null),
      beenCount: async () => count,
      cheapestDrop: async () => cheapestBeenCardDrop(drops, "sam"),
      now: () => 5_000,
    };
  }

  it("signs the server's count and cheapest pint for the owner", async () => {
    const drops = [drop({ id: "dear", priceGbp: 6 }), drop({ id: "cheap", priceGbp: 3.9 })];
    const minted = await mintOwnBeenCardShare(request, "sam", deps(7, "user-sam", drops));
    if (!minted.ok) throw new Error(minted.error);
    const token = decodeURIComponent(minted.path.split("/been/")[1]!);
    expect(minted.path.startsWith("/u/sam/been/")).toBe(true);
    expect(verifyBeenCardShare(token, "sam")).toEqual({ handle: "sam", pubs: 7, dropId: "cheap", issuedAt: 5_000 });
  });

  it("refuses anybody but the owner, a short list and a list with a failed source", async () => {
    expect(await mintOwnBeenCardShare(request, "sam", deps(7, "user-alex"))).toMatchObject({ ok: false, status: 403 });
    expect(await mintOwnBeenCardShare(request, "sam", deps(7, null))).toMatchObject({ ok: false, status: 403 });
    expect(await mintOwnBeenCardShare(request, "sam", deps(4))).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await mintOwnBeenCardShare(request, "sam", deps(5))).toMatchObject({ ok: true, pubs: 5 });
    expect(await mintOwnBeenCardShare(request, "sam", deps(null))).toMatchObject({ ok: false, status: 503 });
    expect(await mintOwnBeenCardShare(request, "nobody", deps(7))).toMatchObject({ ok: false, status: 404 });
  });
});

describe("the card a link draws", () => {
  const publicDrop = {
    id: "cheap",
    venueId: "venue-1",
    venueName: "The Lamb",
    handle: "sam",
    drink: "Guinness",
    measure: "pint",
    priceGbp: 3.9,
    priceEvidence: "receipt",
    createdAt: "2026-11-10T20:00:00.000Z",
    visibility: "public",
  } as PublicDrop;

  function readDeps(found: PublicDrop | null, left = false): BeenCardReadDeps {
    return { accountHandle: async (handle) => left ? null : handle, drop: async () => found };
  }

  it("prints the pint as its receipt while it stands", async () => {
    const token = mintBeenCardShare("sam", 7, "cheap", 5_000);
    const card = await readBeenCard("sam", token, readDeps(publicDrop));
    expect(card).toMatchObject({ pubs: 7, receipt: { venueName: "The Lamb", price: "£3.90", drinker: "@sam", loggedOn: "Tue 10 Nov 2026" } });
  });

  it("drops the pint, and keeps the count, once the drop is no longer the owner's public pint", async () => {
    const token = mintBeenCardShare("sam", 7, "cheap", 5_000);
    expect(await readBeenCard("sam", token, readDeps(null))).toMatchObject({ pubs: 7, receipt: null });
    for (const invalid of [
      { ...publicDrop, visibility: "anonymous", handle: "A PUBMAXXER" },
      { ...publicDrop, visibility: "friends" },
      { ...publicDrop, handle: "alex" },
    ] as PublicDrop[]) {
      expect(await readBeenCard("sam", token, readDeps(invalid))).toMatchObject({ pubs: 7, receipt: null });
    }
  });

  it("draws nothing for an account that left", async () => {
    const token = mintBeenCardShare("sam", 7, "cheap", 5_000);
    expect(await readBeenCard("sam", token, readDeps(publicDrop, true))).toBeNull();
  });
});

describe.each([
  ["memory", memoryPintDropStore],
  ["Supabase", supabasePintDropStore],
] as const)("the complete %s minimum", (_name, store) => {
  it.each(["venue-mcr-cheap", "venue-cheap"])("includes an older minimum at %s after 501 newer drops", async (venueId) => {
    saveDrops([
      storedDrop({ id: "old-cheap", venueId, priceGbp: 3, createdAt: "2026-10-01T20:00:00.000Z" }),
      ...Array.from({ length: 501 }, (_, i) => storedDrop({ id: `new-${i}` })),
      storedDrop({ id: "half", measure: "half", priceGbp: 1 }),
      storedDrop({ id: "friends", visibility: "friends", priceGbp: 1 }),
      storedDrop({ id: "anonymous", visibility: "anonymous", priceGbp: 1 }),
      storedDrop({ id: "hidden", status: "hidden", priceGbp: 1 }),
      storedDrop({ id: "other", handle: "alex", priceGbp: 1 }),
      storedDrop({ id: "retired", authorRetiredAt: "2026-11-01T00:00:00.000Z", priceGbp: 1 }),
    ]);
    const cheapest = await store.cheapestOwnPublicPint("sam");
    expect(cheapest).toMatchObject({ id: "old-cheap", priceGbp: 3 });
    const minted = await mintOwnBeenCardShare(new Request("https://pubmaxxing.com"), "sam", {
      verifyCaller: async () => "user-sam",
      profile: async () => ({ userId: "user-sam", tombstoned: false }),
      beenCount: async () => 5,
      cheapestDrop: (handle) => store.cheapestOwnPublicPint(handle),
      now: () => 5_000,
    });
    if (!minted.ok) throw new Error(minted.error);
    const token = decodeURIComponent(minted.path.split("/been/")[1]!);
    expect(verifyBeenCardShare(token, "sam")?.dropId).toBe("old-cheap");
  });

  it("chooses the newest public pint on a price tie", async () => {
    saveDrops([
      storedDrop({ id: "older", priceGbp: 3, createdAt: "2026-10-01T20:00:00.000Z" }),
      storedDrop({ id: "newer", priceGbp: 3, createdAt: "2026-11-01T20:00:00.000Z" }),
    ]);
    expect(await store.cheapestOwnPublicPint("sam")).toMatchObject({ id: "newer" });
  });

  it("keeps renamed ownership and excludes withdrawn authors", async () => {
    const profile = __seedMemoryOwnedProfile("sam", "user-sam");
    expect((await identityHandleStore().rename("user-sam", "sam2")).ok).toBe(true);
    database.aliases = [
      { profile_id: profile.id, handle: "sam", is_current: false },
      { profile_id: profile.id, handle: "sam2", is_current: true },
    ];
    saveDrops([storedDrop({ id: "old-cheap", priceGbp: 3 })]);
    expect(await store.cheapestOwnPublicPint("sam2")).toMatchObject({ id: "old-cheap", handle: "sam2" });
    __setMemoryProfileWithdrawn(profile.id, true, ["sam"]);
    expect(await store.cheapestOwnPublicPint("sam2")).toBeNull();
  });
});

describe("cards across a handle rename", () => {
  it("keeps old links and old pints, then hides a withdrawn or tombstoned account", async () => {
    const profile = __seedMemoryOwnedProfile("sam", "user-sam");
    saveDrops([storedDrop({ id: "before-rename", priceGbp: 3 })]);
    const oldToken = mintBeenCardShare("sam", 5, "before-rename");
    expect((await identityHandleStore().rename("user-sam", "sam2")).ok).toBe(true);
    const newToken = mintBeenCardShare("sam2", 5, "before-rename");
    for (const [handle, token] of [["sam", oldToken], ["sam2", newToken]] as const) {
      expect(await readBeenCard(handle, token)).toMatchObject({
        handle: "sam2", pubs: 5, receipt: { drinker: "@sam2", price: "£3.00" },
      });
    }
    for (const visibility of ["anonymous", "friends"] as const) {
      saveDrops([storedDrop({ id: "before-rename", visibility })]);
      expect(await readBeenCard("sam", oldToken)).toMatchObject({ pubs: 5, receipt: null });
      expect(await readBeenCard("sam2", newToken)).toMatchObject({ pubs: 5, receipt: null });
    }
    saveDrops([storedDrop({ id: "before-rename", status: "hidden" })]);
    expect(await readBeenCard("sam", oldToken)).toMatchObject({ pubs: 5, receipt: null });
    __setMemoryProfileWithdrawn(profile.id, true, ["sam"]);
    expect(await readBeenCard("sam", oldToken)).toBeNull();
    __setMemoryProfileWithdrawn(profile.id, false);
    __tombstoneMemoryProfile("sam2");
    expect(await readBeenCard("sam", oldToken)).toBeNull();
    expect(await readBeenCard("sam2", newToken)).toBeNull();
  });
});

describe("the Been image response", () => {
  it("prints the pint's own logged day and refuses response caching", async () => {
    const profile = __seedMemoryOwnedProfile("sam", "user-sam");
    saveDrops([storedDrop({ id: "october-pint", priceGbp: 3, createdAt: "2026-10-01T20:00:00.000Z" })]);
    const token = mintBeenCardShare("sam", 5, "october-pint", Date.parse("2026-11-12T12:00:00.000Z"));
    const response = await BeenImage({ params: Promise.resolve({ handle: "sam", token }) });
    const output = await response.text();
    expect(output).toContain("£3.00");
    expect(output).toContain("Logged Thu 1 Oct 2026");
    expect(output).toContain("Counted on 12 Nov 2026");
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    __setMemoryProfileWithdrawn(profile.id, true);
    const withdrawn = await BeenImage({ params: Promise.resolve({ handle: "sam", token }) });
    expect(withdrawn.headers.get("cache-control")).toBe("private, no-store");
    const empty = await withdrawn.text();
    expect(empty).not.toContain("@sam");
    expect(empty).not.toContain("£3.00");
  });
});
