// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({
    user: null, session: null, loading: false, configured: false,
    handle: null, identityResolved: true, getCurrentUserId: () => null,
  }),
}));

import { usePintDrops, type DropWithPhotos, type PintDropsState } from "@/components/map/usePintDrops";
import { venuePriceFallbackPending } from "@/lib/venuePriceLane";

let root: Root;
let container: HTMLDivElement;
let drops: PintDropsState;

function pricedDrop(id: string): DropWithPhotos {
  return {
    id, venueId: "A", handle: "alice", drink: "Beer", measure: "pint",
    priceGbp: 4.7, passedDownNote: "", era: "", provenance: "contributor",
    status: "visible", visibility: "public", createdAt: new Date().toISOString(),
    authorityKey: "alice", pintPhotoUrl: null, venuePhotoUrl: null,
  };
}

function SelectedPub({ venueId }: { venueId: string }) {
  const currentDrops = usePintDrops();
  useEffect(() => { drops = currentDrops; }, [currentDrops]);
  useEffect(() => currentDrops.refreshVenueDrops(venueId), [venueId, currentDrops.refreshVenueDrops]);
  const rows = currentDrops.dropsByVenueId.get(venueId) ?? [];
  const lane = rows.length
    ? { lane: "contributor" as const, contributorPrice: rows[0].priceGbp! }
    : { lane: "estimate" as const, estimate: { priceGbp: 6.5, computedAt: "2026-10-06", basis: "regional_baseline:camden", sampleSize: 8 } };
  return createElement("p", null,
    venuePriceFallbackPending(lane, "ready", currentDrops.venueDropStatus.get(venueId) ?? "idle")
      ? "Checking pub prices" : lane.lane === "contributor" ? `£${lane.contributorPrice.toFixed(2)}` : "est. £6.50",
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ drops: [] }) }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("a reopened pub's pending price read", () => {
  it.each(["ready", "unavailable", "cancelled"] as const)("withholds the estimate during a reopened read (%s)", async (previous) => {
    await act(async () => root.render(createElement(SelectedPub, { venueId: "A" })));
    expect(container.textContent).toBe("est. £6.50");
    if (previous === "unavailable") {
      vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
      await act(async () => { drops.refreshVenueDrops("A"); });
    }
    await act(async () => root.render(createElement(SelectedPub, { venueId: "B" })));
    let answer!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
    await act(async () => root.render(createElement(SelectedPub, { venueId: "A" })));
    expect(container.textContent).toBe("Checking pub prices");
    if (previous === "cancelled") {
      await act(async () => root.render(createElement(SelectedPub, { venueId: "B" })));
    }
    const row = pricedDrop("new-price");
    await act(async () => answer({ ok: true, json: async () => ({ drops: [row] }) } as Response));
    expect(drops.dropsByVenueId.get("A")).toEqual(previous === "cancelled" ? [] : [row]);
    if (previous !== "cancelled") expect(container.textContent).toBe("£4.70");
  });

  it("retains observed rows during refresh and failure", async () => {
    const row = pricedDrop("held-price");
    vi.mocked(fetch).mockImplementation(async (input) => ({
      ok: true, json: async () => ({ drops: String(input).includes("venueId=A") ? [row] : [] }),
    } as Response));
    await act(async () => root.render(createElement(SelectedPub, { venueId: "A" })));
    let fail!: (reason: Error) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    await act(async () => { drops.refreshVenueDrops("A"); });
    expect(container.textContent).toBe("£4.70");
    expect(drops.dropsByVenueId.get("A")).toEqual([row]);
    await act(async () => fail(new Error("offline")));
    expect(container.textContent).toBe("£4.70");
    expect(drops.dropsByVenueId.get("A")).toEqual([row]);
    expect(drops.venueDropStatus.get("A")).toBe("unavailable");
  });
});
