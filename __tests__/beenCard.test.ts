import { describe, expect, it } from "vitest";

// The Been card: a share link exists only once the owner's Been list holds
// enough pubs, carries a count the server signed itself, and shows a pint
// only while it is the owner's own public, priced pint.

import { BEEN_CARD_UNLOCK, beenCardLockedLine, cheapestBeenCardDrop, type BeenCardDrop } from "@/lib/beenCard";
import { mintOwnBeenCardShare, type BeenCardMintDeps } from "@/lib/beenCardMint.server";
import {
  mintBeenCardShare,
  readBeenCard,
  verifyBeenCardShare,
  type BeenCardReadDeps,
} from "@/lib/beenCardShare.server";
import type { PublicDrop } from "@/lib/pintDropLookup";

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
    expect(beenCardLockedLine(BEEN_CARD_UNLOCK - 1)).toBe("1 more pub and you can share your Been card.");
    expect(beenCardLockedLine(2)).toBe(`${BEEN_CARD_UNLOCK - 2} more pubs and you can share your Been card.`);
    expect(beenCardLockedLine(BEEN_CARD_UNLOCK)).toBeNull();
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

  it("will not sign a count below the unlock", () => {
    expect(() => mintBeenCardShare("sam", BEEN_CARD_UNLOCK - 1, null)).toThrow();
  });
});

describe("the owner's mint", () => {
  const request = new Request("https://pubmaxxing.com/api/profiles/sam/been-card");

  function deps(count: number | null, caller: string | null = "user-sam", drops: BeenCardDrop[] = []): BeenCardMintDeps {
    return {
      verifyCaller: async () => caller,
      profile: async (handle) => (handle === "sam" ? { userId: "user-sam", tombstoned: false } : null),
      beenCount: async () => count,
      ownDrops: async () => drops,
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
    expect(await mintOwnBeenCardShare(request, "sam", deps(BEEN_CARD_UNLOCK - 1))).toMatchObject({
      ok: false,
      status: 409,
    });
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
    return { accountLeft: async () => left, drop: async () => found };
  }

  it("prints the pint as its receipt while it stands", async () => {
    const token = mintBeenCardShare("sam", 7, "cheap", 5_000);
    const card = await readBeenCard("sam", token, readDeps(publicDrop));
    expect(card).toMatchObject({ pubs: 7, receipt: { venueName: "The Lamb", price: "£3.90", drinker: "@sam" } });
  });

  it("drops the pint, and keeps the count, once the drop is no longer the owner's public pint", async () => {
    const token = mintBeenCardShare("sam", 7, "cheap", 5_000);
    expect(await readBeenCard("sam", token, readDeps(null))).toMatchObject({ pubs: 7, receipt: null });
    const anonymous = { ...publicDrop, visibility: "anonymous", handle: "A PUBMAXXER" } as PublicDrop;
    expect(await readBeenCard("sam", token, readDeps(anonymous))).toMatchObject({ pubs: 7, receipt: null });
  });

  it("draws nothing for an account that left", async () => {
    const token = mintBeenCardShare("sam", 7, "cheap", 5_000);
    expect(await readBeenCard("sam", token, readDeps(publicDrop, true))).toBeNull();
  });
});
