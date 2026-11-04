// @vitest-environment jsdom

// A PREVIEW URL LIVES AS LONG AS SOMETHING SHOWS IT (review findings CMP-2 and
// NEW-1). Changing one photo slot may not revoke another slot's preview,
// posting may not revoke the previews the optimistic row is about to render,
// and unmount revokes whatever is still held.

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ post: vi.fn() }));
import { readProviderAccountRevision, setProviderIdentity } from "@/lib/authProviderRevision";

vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({
    user: null, session: null, loading: false, configured: false,
    handle: null, identityResolved: true, getCurrentUserId: () => null,
  }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: io.post }));

import { usePintDrops, type PintDropsState } from "@/components/map/usePintDrops";
import { PintDropAgeRecovery } from "@/components/map/PintDropAgeRecovery";
import { ADULT_ASSERTED_EVENT } from "@/lib/contributionGateStatus";
import { readOptimisticSpills } from "@/lib/optimisticSpillPost";

let container: HTMLDivElement;
let root: Root;
let drops: PintDropsState;
let minted = 0;

function DropProbe() {
  const state = usePintDrops();
  useEffect(() => { drops = state; }, [state]);
  return state.dropMsg ? createElement(PintDropAgeRecovery, {
    recovery: state.dropMsg.ageRecovery, onAsserted: state.ageAsserted,
  }) : null;
}

function photo(name: string): File {
  return new File([new Uint8Array(8)], name, { type: "image/jpeg" });
}

const revoked = () => vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url);

beforeEach(async () => {
  setProviderIdentity("supabase", "preview-account-a");
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");
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
  vi.unstubAllEnvs();
});

describe("Pint Drop preview URL lifetime", () => {
  it.each([true, false])("requires an explicit price retry after the shared assertion (bill: %s)", async (withBill) => {
    io.post.mockResolvedValue(new Response("{}", { status: 200 }));
    io.post.mockResolvedValueOnce(new Response(JSON.stringify({
      status: "adult_check_required", error: "Confirm you are 18 or over before contributing.",
    }), { status: 409 }));
    await act(async () => {
      if (withBill) drops.pickPhoto("receipt", photo("bill.jpg"), null);
      drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale" }));
    });
    await act(async () => { await drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
    io.post.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await act(async () => { container.querySelector("button")!.click(); });
    expect(io.post.mock.calls.map(([url]) => url)).toEqual(["/api/pint-drops", "/api/identity/adult-assertion"]);
    expect(drops.dropMsg?.text).toBe("Age confirmation saved. Submit your price again.");
    expect(container.querySelector("button")).toBeNull();
    io.post.mockResolvedValueOnce(new Response(JSON.stringify({ drop: {
      id: "drop-retried", venueId: "venue-1", handle: "alice", priceGbp: 5.5,
      drink: "Pale ale", passedDownNote: "", era: "", vibeTags: [],
      visibility: "public", provenance: "contributor", status: "visible",
      createdAt: new Date().toISOString(), pintPhotoUrl: null, venuePhotoUrl: null,
      priceEvidence: withBill ? "receipt" : "unchecked",
    } }), { status: 201 }));
    await act(async () => {
      if (withBill) drops.pickPhoto("receipt", photo("bill.jpg"), null);
      drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale" }));
    });
    await act(async () => { await drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
    expect(io.post.mock.calls.filter(([url]) => url === "/api/pint-drops")).toHaveLength(2);
    expect(io.post.mock.calls.filter(([url]) => url === "/api/identity/adult-assertion")).toHaveLength(1);
    expect(drops.dropMsg?.ok).toBe(true);
    expect(drops.dropsByVenueId.get("venue-1")?.some((drop) => drop.id === "drop-retried")).toBe(true);
  });

  it("keeps a refused assertion retryable without posting another price", async () => {
    io.post.mockResolvedValueOnce(new Response(JSON.stringify({ status: "adult_check_required" }), { status: 409 }));
    await act(async () => { drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale" })); });
    await act(async () => { await drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
    io.post.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await act(async () => { container.querySelector("button")!.click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("We could not save that just now. Try again.");
    expect(container.querySelector("button")?.disabled).toBe(false);
    io.post.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await act(async () => { container.querySelector("button")!.click(); });
    expect(container.querySelector("button")).toBeNull();
    expect(io.post.mock.calls.filter(([url]) => url === "/api/pint-drops")).toHaveLength(1);
  });

  it.each([201, 409])("ignores a delayed price response after the account changes (status: %s)", async (status) => {
    let answer!: (response: Response) => void;
    io.post.mockReturnValueOnce(new Promise<Response>((resolve) => { answer = resolve; }));
    await act(async () => { drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale" })); });
    let pending: void | Promise<void>;
    await act(async () => { pending = drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
    await act(async () => { setProviderIdentity("supabase", "preview-account-b"); });
    await act(async () => {
      answer(new Response(JSON.stringify({
        status: "adult_check_required", error: "Old account refusal",
        drop: { id: "old-account-price", venueId: "venue-1" },
      }), { status }));
      await pending;
    });
    expect(container.querySelector("button")).toBeNull();
    expect(drops.dropMsg?.text).not.toBe("Old account refusal");
    expect(drops.dropsByVenueId.get("venue-1")?.some((drop) => drop.id === "old-account-price")).toBe(false);
  });

  it.each([200, 503])("ignores a delayed assertion response after an account change (status: %s)", async (status) => {
    io.post.mockResolvedValueOnce(new Response(JSON.stringify({ status: "adult_check_required" }), { status: 409 }));
    await act(async () => { drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale" })); });
    await act(async () => { await drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
    let answer!: (response: Response) => void;
    io.post.mockReturnValueOnce(new Promise<Response>((resolve) => { answer = resolve; }));
    const asserted = vi.fn();
    window.addEventListener(ADULT_ASSERTED_EVENT, asserted);
    try {
      await act(async () => { container.querySelector("button")!.click(); });
      expect(io.post).toHaveBeenCalledTimes(2);
      await act(async () => { setProviderIdentity("supabase", "preview-account-b"); });
      expect(container.querySelector("button")).toBeNull();
      await act(async () => { answer(new Response("{}", { status })); });
      expect(asserted).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(drops.dropMsg?.text).not.toContain("Age confirmation saved");
    } finally {
      window.removeEventListener(ADULT_ASSERTED_EVENT, asserted);
    }
  });

  it.each(["adult_check_required", "adult_check_failed"])(
    "offers age confirmation only when the server answers %s", async (status) => {
      io.post.mockResolvedValue({
        ok: false,
        json: async () => ({ status, error: "The account age check refused this price." }),
      });
      await act(async () => {
        drops.pickPhoto("receipt", photo("bill.jpg"), null);
        drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale" }));
      });
      await act(async () => {
        await drops.submitDrop({ preventDefault() {} } as never, "venue-1");
      });
      expect(drops.dropMsg?.ok).toBe(false);
      expect(drops.dropMsg?.text).toBe("The account age check refused this price.");
      if (status === "adult_check_required") {
        expect(container.querySelector("button")?.textContent).toBe("I'm 18 or over");
        expect(drops.dropMsg?.ageRecovery).toEqual({ accountRevision: readProviderAccountRevision() });
      } else {
        expect(container.querySelector("button")).toBeNull();
        expect(drops.dropMsg?.ageRecovery).toBeUndefined();
      }
    },
  );

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
