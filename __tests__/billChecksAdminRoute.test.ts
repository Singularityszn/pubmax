import { beforeEach, describe, expect, it, vi } from "vitest";

// app/api/admin/bill-checks/route.ts: the moderation queue of bills that do not
// show their price (captain 5 Nov 2026). A moderator sees the submitted price,
// the lines the bill showed and the bill itself, and either keeps the price or
// hides it through its lane's own moderator door. Either way the check is
// stamped, and nothing is deleted.

const receiptSigning = vi.hoisted(() => ({
  sign: vi.fn(async (key: string) => ({ data: { signedUrl: `https://storage.test/${key}` }, error: null })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requireSupabaseAdmin: () => ({ storage: { from: () => ({ createSignedUrl: receiptSigning.sign }) } }),
  };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const { gate } = vi.hoisted(() => ({ gate: { open: true } }));
vi.mock("@/lib/adminAuth", () => ({ isModerator: () => gate.open }));

const seams = vi.hoisted(() => ({
  hidePrice: vi.fn(async () => ({ status: "ok" as const, changed: true, kind: "price" as const })),
  syncHidden: vi.fn(async () => ({ status: "synced" as const })),
}));
vi.mock("@/lib/communityPriceStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/communityPriceStore")>(),
  moderateCommunityPriceWithState: seams.hidePrice,
}));
vi.mock("@/lib/priceTrustImpact.server", () => ({
  syncTrustAfterPriceHidden: seams.syncHidden,
}));

import { GET, POST } from "@/app/api/admin/bill-checks/route";
import { __resetBillChecks, memoryBillCheckStore } from "@/lib/billCheckStore";
import { __resetPintDrops, addPintDrop, findPintDropsByIds, type PintDrop } from "@/lib/pintDrops";
import { memoryPintDropStore } from "@/lib/pintDropsStore";
import { __resetMemoryRounds, memoryRoundsStore } from "@/lib/roundsStore";
import { __resetCommunityPrices, memoryCommunityPriceStore } from "@/lib/communityPriceStore";

const URL_BASE = "http://localhost/api/admin/bill-checks";
const VENUE = "venue-1vle947";

function drop(id: string): PintDrop {
  return {
    id,
    venueId: VENUE,
    handle: "billed_drinker",
    drink: "Guinness",
    measure: "pint",
    priceGbp: 4.5,
    priceEvidence: "unchecked",
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: "2026-11-05T19:30:00.000Z",
  };
}

function post(body: unknown): Promise<Response> {
  return POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  gate.open = true;
  __resetBillChecks();
  __resetPintDrops();
  __resetMemoryRounds();
  __resetCommunityPrices();
  receiptSigning.sign.mockClear();
  seams.hidePrice.mockClear();
  seams.syncHidden.mockClear();
});

describe("GET /api/admin/bill-checks", () => {
  it("returns the submitted community drink and price with the read lines and no photo", async () => {
    const submittedAt = Date.parse("2026-11-05T19:30:00.000Z");
    const { price } = await memoryCommunityPriceStore.submit({
      venueId: VENUE, drinkCategory: "coffee", priceGbp: 4,
    }, submittedAt);
    if (!price) throw new Error("Community price was not saved");
    await memoryBillCheckStore.record({
      communityPriceId: price.id, communityPriceSubmittedAt: submittedAt,
      billHash: "c".repeat(64), venueId: VENUE, priceGbp: 4,
      result: "mismatch", lines: [{ name: "Coffee", priceGbp: 3 }],
    });

    const response = await GET(new Request(URL_BASE));
    expect(response.status).toBe(200);
    expect((await response.json()).checks).toEqual([expect.objectContaining({
      communityPriceId: price.id, submittedDrink: "Coffee", priceGbp: 4,
      communityOnly: true, receiptPhotoUrl: null,
      lines: [{ name: "Coffee", priceGbp: 3 }],
    })]);
    expect(receiptSigning.sign).not.toHaveBeenCalled();
  });

  it("refuses anybody who is not a moderator", async () => {
    gate.open = false;
    const res = await GET(new Request(URL_BASE));
    expect(res.status).toBe(403);
  });

  it("lists each unreviewed mismatch with the price, the lines and the drop it names", async () => {
    addPintDrop(drop("drop-1"));
    const mismatch = await memoryBillCheckStore.record({
      billHash: "a".repeat(64),
      pintDropId: "drop-1",
      venueId: VENUE,
      priceGbp: 4.5,
      result: "mismatch",
      lines: [{ name: "Guinness", priceGbp: 6.2 }],
    });
    await memoryBillCheckStore.record({
      billHash: "a".repeat(64),
      pintDropId: "drop-2",
      venueId: VENUE,
      priceGbp: 4.5,
      result: "match",
      lines: [{ name: "Guinness", priceGbp: 4.5 }],
    });

    const res = await GET(new Request(URL_BASE));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const { checks } = await res.json();
    expect(checks).toEqual([
      expect.objectContaining({
        id: mismatch.id,
        venueId: VENUE,
        venueName: expect.any(String),
        priceGbp: 4.5,
        lines: [{ name: "Guinness", priceGbp: 6.2 }],
        pintDropId: "drop-1",
        receiptPhotoUrl: null,
        drop: expect.objectContaining({ handle: "billed_drinker", status: "visible", serving: "Pint" }),
      }),
    ]);
  });

  // A half on the bill against a pint sent at the same price is a mismatch the
  // moderator cannot see unless the card names the serving that was sent.
  it("names the serving the drop was sent with, and none when it stated none", async () => {
    addPintDrop(drop("drop-pint"));
    addPintDrop({ ...drop("drop-plain"), measure: undefined });
    for (const id of ["drop-pint", "drop-plain"]) {
      await memoryBillCheckStore.record({
        billHash: "b".repeat(64),
        pintDropId: id,
        venueId: VENUE,
        priceGbp: 4.5,
        result: "mismatch",
        lines: [{ name: "1/2 Guinness", priceGbp: 4.5 }],
      });
    }
    const { checks } = await (await GET(new Request(URL_BASE))).json();
    const byDrop = new Map(checks.map((row: { pintDropId: string; drop: unknown }) => [row.pintDropId, row.drop]));
    expect(byDrop.get("drop-pint")).toMatchObject({ drink: "Guinness", serving: "Pint" });
    expect(byDrop.get("drop-plain")).not.toHaveProperty("serving");
  });
});

describe("Round bill photos in moderation", () => {
  it.each([true, false])("shows the stored Round bill only when the price and source match: %s", async (matches) => {
    const created = await memoryRoundsStore.create({ createdByHandle: "billed_drinker" });
    if (!created.ok) throw new Error("Round was not created");
    const code = created.state.round.code;
    await memoryRoundsStore.addStop(code, { venueId: VENUE, venueName: "The Ship", addedByHandle: "billed_drinker" });
    const recorded = await memoryRoundsStore.recordSpend(code, {
      clientRef: "original-bill", payerHandle: "billed_drinker", recordedByHandle: "billed_drinker", venueId: VENUE, venueName: "The Ship",
      items: [{ drinkName: "Guinness", drinkCategory: "beer", priceGbp: 4.5 }],
    });
    if (!recorded.ok) throw new Error("Spend was not saved");
    const spend = recorded.state.spends[0]!;
    spend.receiptPhotoKey = `${VENUE}/${spend.id}/receipt.jpg`;
    const check = await memoryBillCheckStore.record({
      communityPriceId: "price-round", communityPriceSubmittedAt: Date.parse(spend.recordedAt),
      roundSource: { spendId: spend.id, lineIndex: 0 },
      billHash: "b".repeat(64), venueId: VENUE, priceGbp: matches ? 4.5 : 5.5,
      result: "mismatch", lines: [{ name: "Guinness", priceGbp: 6.2 }],
    });
    const response = await GET(new Request(URL_BASE));
    expect(response.status).toBe(200);
    expect((await response.json()).checks).toEqual([expect.objectContaining({
      id: check.id,
      receiptPhotoUrl: matches ? `https://storage.test/${spend.receiptPhotoKey}` : null,
    })]);
    expect(receiptSigning.sign).toHaveBeenCalledTimes(matches ? 1 : 0);
    if (matches) expect(receiptSigning.sign).toHaveBeenCalledWith(spend.receiptPhotoKey, 3600);
    expect(await memoryRoundsStore.getSpendById(spend.id)).toMatchObject({ id: spend.id, receiptPhotoKey: spend.receiptPhotoKey });
    expect(await memoryRoundsStore.getSpendById("missing-spend")).toBeNull();
  });
});

describe("POST /api/admin/bill-checks", () => {
  async function seedMismatch(over: { pintDropId?: string; communityPriceId?: string } = { pintDropId: "drop-1" }) {
    if (over.pintDropId) addPintDrop(drop(over.pintDropId));
    return memoryBillCheckStore.record({
      ...over,
      ...(over.communityPriceId ? { communityPriceSubmittedAt: Date.parse("2026-11-05T19:30:00.000Z") } : {}),
      billHash: "a".repeat(64),
      venueId: VENUE,
      priceGbp: 4.5,
      result: "mismatch",
      lines: [{ name: "Guinness", priceGbp: 6.2 }],
    });
  }

  it("refuses anybody who is not a moderator", async () => {
    gate.open = false;
    expect((await post({ id: "x", decision: "kept" })).status).toBe(403);
  });

  it("refuses an unknown decision", async () => {
    const check = await seedMismatch();
    const res = await post({ id: check.id, decision: "delete" });
    expect(res.status).toBe(400);
  });

  it("keeps the price, stamps the check and leaves the queue", async () => {
    const check = await seedMismatch();
    const res = await post({ id: check.id, decision: "kept" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, check: { id: check.id, reviewDecision: "kept" } });
    expect(findPintDropsByIds(["drop-1"]).get("drop-1")?.status).toBe("visible");
    expect(await memoryBillCheckStore.listMismatchesForReview()).toEqual([]);
  });

  it("hides the drop and its paired community price, then stamps the check, and deletes nothing", async () => {
    const check = await seedMismatch({ pintDropId: "drop-1", communityPriceId: "price-1" });
    const res = await post({ id: check.id, decision: "hidden" });
    expect(res.status).toBe(200);
    const hidden = findPintDropsByIds(["drop-1"]).get("drop-1");
    expect(hidden).toBeDefined();
    expect(hidden?.status).toBe("hidden");
    expect(seams.hidePrice).toHaveBeenCalledWith("price-1", true, expect.stringMatching(/bill/i), { submittedAt: Date.parse("2026-11-05T19:30:00.000Z"), priceGbp: 4.5 });
    expect(seams.syncHidden).toHaveBeenCalledWith("price-1");
    expect(await memoryBillCheckStore.listMismatchesForReview()).toEqual([]);
  });

  it("returns a failed community hide to the queue and completes another attempt", async () => {
    const check = await seedMismatch({ communityPriceId: "price-1" });
    seams.hidePrice.mockResolvedValueOnce({ status: "unavailable" } as never);
    const res = await post({ id: check.id, decision: "hidden" });
    expect(res.status).toBe(503);
    expect(await memoryBillCheckStore.listMismatchesForReview()).toMatchObject([{ id: check.id }]);
    expect((await post({ id: check.id, decision: "hidden" })).status).toBe(200);
    expect(await memoryBillCheckStore.listMismatchesForReview()).toEqual([]);
    expect(seams.hidePrice).toHaveBeenCalledTimes(2);
  });

  it("returns a failed drop hide to the queue and completes another attempt", async () => {
    const check = await seedMismatch({ pintDropId: "drop-1", communityPriceId: "price-1" });
    vi.spyOn(memoryPintDropStore, "moderate").mockResolvedValueOnce(false);
    expect((await post({ id: check.id, decision: "hidden" })).status).toBe(503);
    expect(await memoryBillCheckStore.listMismatchesForReview()).toMatchObject([{ id: check.id }]);
    expect(seams.hidePrice).not.toHaveBeenCalled();
    expect((await post({ id: check.id, decision: "hidden" })).status).toBe(200);
    expect(findPintDropsByIds(["drop-1"]).get("drop-1")?.status).toBe("hidden");
    expect(await memoryBillCheckStore.listMismatchesForReview()).toEqual([]);
  });

  it("repeats a failed trust update after the community price is already hidden", async () => {
    const check = await seedMismatch({ pintDropId: "drop-1", communityPriceId: "price-1" });
    seams.syncHidden.mockResolvedValueOnce({ status: "unavailable" } as never);
    expect((await post({ id: check.id, decision: "hidden" })).status).toBe(503);
    expect(await memoryBillCheckStore.listMismatchesForReview()).toMatchObject([{ id: check.id }]);
    seams.hidePrice.mockResolvedValueOnce({ status: "ok", changed: false, kind: "price" });
    expect((await post({ id: check.id, decision: "hidden" })).status).toBe(200);
    expect(seams.syncHidden).toHaveBeenCalledTimes(2);
    expect(await memoryBillCheckStore.listMismatchesForReview()).toEqual([]);
  });

  it.each(["drop", "community", "trust"])("releases a hide claim when the %s operation throws", async (operation) => {
    const check = await seedMismatch({ pintDropId: "drop-1", communityPriceId: "price-1" });
    const fail = operation === "drop" ? vi.spyOn(memoryPintDropStore, "moderate")
      : operation === "community" ? seams.hidePrice : seams.syncHidden;
    fail.mockRejectedValueOnce(new Error("unavailable"));
    expect((await post({ id: check.id, decision: "hidden" })).status).toBe(503);
    expect(await memoryBillCheckStore.listMismatchesForReview()).toMatchObject([{ id: check.id }]);
    expect((await post({ id: check.id, decision: "hidden" })).status).toBe(200);
    expect(await memoryBillCheckStore.listMismatchesForReview()).toEqual([]);
  });

  it("allows only one concurrent decision to change the subjects", async () => {
    const check = await seedMismatch({ pintDropId: "drop-1", communityPriceId: "price-1" });
    const responses = await Promise.all([
      post({ id: check.id, decision: "kept" }),
      post({ id: check.id, decision: "hidden" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 404]);
    const winner = await responses.find((response) => response.status === 200)!.json();
    const hidden = winner.check.reviewDecision === "hidden";
    expect(findPintDropsByIds(["drop-1"]).get("drop-1")?.status).toBe(hidden ? "hidden" : "visible");
    expect(seams.hidePrice).toHaveBeenCalledTimes(hidden ? 1 : 0);
  });

  it("keeps a skipped community hide pending without reconciling the newer observation", async () => {
    const check = await seedMismatch({ communityPriceId: "price-1" });
    seams.hidePrice.mockResolvedValueOnce({ status: "ok", changed: false } as never);
    expect((await post({ id: check.id, decision: "hidden" })).status).toBe(503);
    expect(seams.syncHidden).not.toHaveBeenCalled();
    expect(await memoryBillCheckStore.listMismatchesForReview()).toMatchObject([{ id: check.id }]);
    expect((await post({ id: check.id, decision: "hidden" })).status).toBe(200);
    expect(await memoryBillCheckStore.listMismatchesForReview()).toEqual([]);
  });

  it("answers 404 to a check that is not waiting in the queue", async () => {
    const check = await seedMismatch();
    await post({ id: check.id, decision: "kept" });
    expect((await post({ id: check.id, decision: "kept" })).status).toBe(404);
    expect((await post({ id: "check-unknown", decision: "kept" })).status).toBe(404);
  });
});
