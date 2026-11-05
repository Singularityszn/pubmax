import { beforeEach, describe, expect, it, vi } from "vitest";

// app/api/admin/bill-checks/route.ts: the moderation queue of bills that do not
// show their price (captain 5 Nov 2026). A moderator sees the submitted price,
// the lines the bill showed and the bill itself, and either keeps the price or
// hides it through its lane's own moderator door. Either way the check is
// stamped, and nothing is deleted.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const { gate } = vi.hoisted(() => ({ gate: { open: true } }));
vi.mock("@/lib/adminAuth", () => ({ isModerator: () => gate.open }));

const seams = vi.hoisted(() => ({
  hidePrice: vi.fn(async () => ({ status: "ok" as const, changed: true, kind: "price" as const })),
  syncHidden: vi.fn(async () => ({ status: "synced" as const })),
}));
vi.mock("@/lib/communityPriceStore", () => ({
  moderateCommunityPriceWithState: seams.hidePrice,
}));
vi.mock("@/lib/priceTrustImpact.server", () => ({
  syncTrustAfterPriceHidden: seams.syncHidden,
}));

import { GET, POST } from "@/app/api/admin/bill-checks/route";
import { __resetBillChecks, memoryBillCheckStore } from "@/lib/billCheckStore";
import { __resetPintDrops, addPintDrop, findPintDropsByIds, type PintDrop } from "@/lib/pintDrops";

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
  gate.open = true;
  __resetBillChecks();
  __resetPintDrops();
  seams.hidePrice.mockClear();
  seams.syncHidden.mockClear();
});

describe("GET /api/admin/bill-checks", () => {
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
        drop: expect.objectContaining({ handle: "billed_drinker", status: "visible", receiptPhotoUrl: null }),
      }),
    ]);
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

  it("keeps the review claimed when the hide fails", async () => {
    const check = await seedMismatch({ communityPriceId: "price-1" });
    seams.hidePrice.mockResolvedValueOnce({ status: "unavailable" } as never);
    const res = await post({ id: check.id, decision: "hidden" });
    expect(res.status).toBe(503);
    expect(await memoryBillCheckStore.listMismatchesForReview()).toEqual([]);
    expect((await post({ id: check.id, decision: "kept" })).status).toBe(404);
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

  it("does not reconcile a newer community observation when the checked revision no longer exists", async () => {
    const check = await seedMismatch({ communityPriceId: "price-1" });
    seams.hidePrice.mockResolvedValueOnce({ status: "ok", changed: false } as never);
    expect((await post({ id: check.id, decision: "hidden" })).status).toBe(200);
    expect(seams.syncHidden).not.toHaveBeenCalled();
  });

  it("answers 404 to a check that is not waiting in the queue", async () => {
    const check = await seedMismatch();
    await post({ id: check.id, decision: "kept" });
    expect((await post({ id: check.id, decision: "kept" })).status).toBe(404);
    expect((await post({ id: "check-unknown", decision: "kept" })).status).toBe(404);
  });
});
