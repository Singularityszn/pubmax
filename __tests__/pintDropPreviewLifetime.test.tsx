// @vitest-environment jsdom

// A PREVIEW URL LIVES AS LONG AS SOMETHING SHOWS IT (review findings CMP-2 and
// NEW-1). Changing one photo slot may not revoke another slot's preview,
// posting may not revoke the previews the optimistic row is about to render,
// and unmount revokes whatever is still held.

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({
    user: null, session: null, loading: false, configured: false,
    handle: null, identityResolved: true, getCurrentUserId: () => null,
  }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: io.post }));

import { usePintDrops, type PintDropsState } from "@/components/map/usePintDrops";
import { readOptimisticSpills } from "@/lib/optimisticSpillPost";

let container: HTMLDivElement;
let root: Root;
let drops: PintDropsState;
let minted = 0;

function DropProbe() {
  const state = usePintDrops();
  useEffect(() => { drops = state; }, [state]);
  return null;
}

function photo(name: string): File {
  return new File([new Uint8Array(8)], name, { type: "image/jpeg" });
}

const revoked = () => vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url);

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("pubmax_handle", "alice");
  minted = 0;
  io.post.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ drops: [] }) }));
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => `blob:preview-${++minted}`),
    revokeObjectURL: vi.fn(),
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(DropProbe)); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Pint Drop preview URL lifetime", () => {
  it("changing the receipt slot revokes only the receipt it replaced", async () => {
    await act(async () => { drops.pickPhoto("pint", photo("pint.jpg"), null); });
    await act(async () => { drops.pickPhoto("receipt", photo("bill.jpg"), null); });
    expect(revoked()).toEqual([]);
    await act(async () => { drops.pickPhoto("receipt", photo("bill-2.jpg"), null); });
    expect(revoked()).toEqual(["blob:preview-2"]);
    expect(drops.pintPhoto?.previewUrl).toBe("blob:preview-1");
    await act(async () => { drops.removePhoto("receipt"); });
    expect(revoked()).toEqual(["blob:preview-2", "blob:preview-3"]);
  });

  it("unmount revokes every preview still held, once each", async () => {
    await act(async () => { drops.pickPhoto("pint", photo("pint.jpg"), null); });
    await act(async () => { drops.pickPhoto("venue", photo("venue.jpg"), null); });
    await act(async () => { drops.pickPhoto("venue", photo("venue-2.jpg"), null); });
    await act(async () => root.unmount());
    expect(revoked().sort()).toEqual(["blob:preview-1", "blob:preview-2", "blob:preview-3"]);
    root = createRoot(container);
  });

  it("posting keeps the previews the optimistic row shows until the server row replaces it", async () => {
    let answer!: (value: unknown) => void;
    io.post.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    await act(async () => { drops.pickPhoto("pint", photo("pint.jpg"), null); });
    await act(async () => { drops.pickPhoto("receipt", photo("bill.jpg"), null); });
    await act(async () => {
      drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale" }));
    });
    await act(async () => {
      drops.submitDrop({ preventDefault() {} } as never, "venue-1", { venueName: "The Crown" });
    });

    expect(drops.pintPhoto).toBeNull();
    expect(drops.receiptPhoto).toBeNull();
    const optimistic = drops.dropsByVenueId.get("venue-1")?.[0];
    expect(optimistic?.pintPhotoUrl).toBe("blob:preview-1");
    expect(optimistic?.receiptPhotoUrl).toBe("blob:preview-2");
    expect(revoked()).toEqual([]);

    // A blob: URL dies with the document, so it is never written to storage.
    const stored = readOptimisticSpills(localStorage);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.drop.pintPhotoUrl).toBeNull();
    expect(localStorage.getItem("pubmax:optimistic-spill-posts:v1")).not.toContain("blob:");

    await act(async () => {
      answer({
        ok: true,
        json: async () => ({
          drop: {
            id: "drop-1", venueId: "venue-1", handle: "alice", priceGbp: 5.5,
            drink: "Pale ale", passedDownNote: "", era: "", vibeTags: [],
            provenance: "contributor", status: "visible", visibility: "public",
            pintPhotoUrl: "https://cdn.example/pint.jpg", venuePhotoUrl: null,
            createdAt: new Date().toISOString(),
          },
        }),
      });
    });
    expect(drops.dropsByVenueId.get("venue-1")?.[0]?.id).toBe("drop-1");
    expect(revoked().sort()).toEqual(["blob:preview-1", "blob:preview-2"]);

    await act(async () => root.unmount());
    expect(revoked()).toHaveLength(2);
    root = createRoot(container);
  });
});
