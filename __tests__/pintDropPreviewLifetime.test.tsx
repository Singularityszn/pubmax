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
vi.mock("@/components/map/composer/useVenueDraft", () => ({ useVenueDraft: () => true }));
vi.mock("@/components/map/composer/useIsMobileComposer", () => ({ useIsMobileComposer: () => true }));
vi.mock("@/components/map/composer/useSpeechDictation", () => ({
  useSpeechDictation: () => ({ speechSupported: false, listening: false, error: "", toggleListening: () => {} }),
}));
vi.mock("@/components/map/composer/useActiveRound", () => ({ useActiveRound: () => false }));
vi.mock("@/components/map/VenuePriceStory", () => ({ default: () => null }));
vi.mock("@/components/map/inspector/PintDropsList", () => ({ default: () => null }));

import { usePintDrops, type PintDropsState } from "@/components/map/usePintDrops";
import { PintDropAgeRecovery } from "@/components/map/PintDropAgeRecovery";
import VenuePintsTab from "@/components/map/inspector/VenuePintsTab";
import { ADULT_ASSERTED_EVENT } from "@/lib/contributionGateStatus";
import { buildOptimisticSpillRetryFormData, readOptimisticSpills } from "@/lib/optimisticSpillPost";

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

function ComposerProbe({ open }: { open: boolean }) {
  const state = usePintDrops();
  useEffect(() => { drops = state; }, [state]);
  return createElement(VenuePintsTab, {
    venue: { id: "venue-1", name: "The Crown" } as never,
    tab: "pints", pintDrops: { ...state, composerOpen: open }, drops: [], lastTrainDecision: null,
  });
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
  // Account ownership applies to the displayed refusal, not only its action.
  it.each([
    [true, "adult_check_required", "Confirm you are 18 or over before contributing."],
    [false, "adult_check_required", "Confirm you are 18 or over before contributing."],
    [true, "adult_check_failed", "Your recorded date of birth is under 18."],
    [false, "adult_check_failed", "Your recorded date of birth is under 18."],
  ] as const)("removes a displayed age refusal on account switch (open: %s, status: %s)", async (open, status, message) => {
    await act(async () => { root.render(createElement(ComposerProbe, { open })); });
    io.post.mockResolvedValueOnce(new Response(JSON.stringify({ status, error: message }), { status: 409 }));
    await act(async () => { drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale" })); });
    await act(async () => { await drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
    await act(async () => { setProviderIdentity("supabase", "preview-account-b"); });
    expect(container.textContent).not.toContain(message);
    expect(container.textContent).not.toContain("I'm 18 or over");
    expect(drops.dropMsg).toBeNull();
    await act(async () => { setProviderIdentity("supabase", "preview-account-a"); });
    expect(container.textContent).not.toContain(message);
    expect(io.post).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("finishes the refused price as the same request after the adult tap (bill: %s)", async (withBill) => {
    io.post.mockResolvedValueOnce(new Response(JSON.stringify({
      status: "adult_check_required", error: "Confirm you are 18 or over before contributing.",
    }), { status: 409 }));
    await act(async () => {
      if (withBill) drops.pickPhoto("receipt", photo("bill.jpg"), null);
      drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale", measure: "half" }));
    });
    await act(async () => { await drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
    expect(drops.dropForm.price).toBe("");
    io.post.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    io.post.mockResolvedValueOnce(new Response(JSON.stringify({ drop: {
      id: "drop-finished", venueId: "venue-1", handle: "alice", priceGbp: 5.5,
      drink: "Pale ale", measure: "half", passedDownNote: "", era: "", vibeTags: [],
      visibility: "public", provenance: "contributor", status: "visible",
      createdAt: new Date().toISOString(), pintPhotoUrl: null, venuePhotoUrl: null,
      priceEvidence: "unchecked",
    } }), { status: 201 }));
    await act(async () => { container.querySelector("button")!.click(); });
    expect(io.post.mock.calls.map(([url]) => url)).toEqual([
      "/api/pint-drops", "/api/identity/adult-assertion", "/api/pint-drops",
    ]);
    const refused = io.post.mock.calls[0]![1].body as FormData;
    const finished = io.post.mock.calls[2]![1].body as FormData;
    expect(finished.get("clientRequestId")).toBe(refused.get("clientRequestId"));
    expect(finished.get("priceGbp")).toBe("5.50");
    expect(finished.get("measure")).toBe("half");
    expect(finished.get("drink")).toBe("Pale ale");
    expect(finished.has("receipt_photo")).toBe(withBill);
    expect(drops.dropMsg?.ok).toBe(true);
    expect(container.querySelector("button")).toBeNull();
    expect(drops.dropsByVenueId.get("venue-1")?.map((drop) => drop.id)).toEqual(["drop-finished"]);
    expect(readOptimisticSpills(localStorage).map(({ drop }) => drop.id)).toEqual(["drop-finished"]);
  });

  it("posts the held price only after an assertion the server accepted", async () => {
    io.post.mockResolvedValueOnce(new Response(JSON.stringify({ status: "adult_check_required" }), { status: 409 }));
    await act(async () => { drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale" })); });
    await act(async () => { await drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
    io.post.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await act(async () => { container.querySelector("button")!.click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("We could not save that just now. Try again.");
    expect(container.querySelector("button")?.disabled).toBe(false);
    expect(io.post.mock.calls.filter(([url]) => url === "/api/pint-drops")).toHaveLength(1);
    io.post.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    io.post.mockResolvedValueOnce(new Response(JSON.stringify({ status: "adult_check_required" }), { status: 409 }));
    await act(async () => { container.querySelector("button")!.click(); });
    expect(io.post.mock.calls.filter(([url]) => url === "/api/pint-drops")).toHaveLength(2);
  });

  it.each([[201, false], [201, true], [409, false], [409, true]] as const)(
    "disposes an abandoned price before its delayed response (status: %s, bill: %s)", async (status, withBill) => {
    let answer!: (response: Response) => void;
    io.post.mockReturnValueOnce(new Promise<Response>((resolve) => { answer = resolve; }));
    await act(async () => {
      drops.pickPhoto("pint", photo("pint.jpg"), null);
      if (withBill) drops.pickPhoto("receipt", photo("bill.jpg"), null);
      drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale" }));
    });
    let pending: void | Promise<void>;
    await act(async () => { pending = drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
    const optimisticId = drops.dropsByVenueId.get("venue-1")?.[0]?.id;
    expect(optimisticId).toMatch(/^optimistic-/);
    expect(drops.dropMsg?.text).toBe("Cheers. Saving your Pint Drop…");
    await act(async () => { setProviderIdentity("supabase", "preview-account-b"); });
    const expectedPreviews = withBill ? ["blob:preview-1", "blob:preview-2"] : ["blob:preview-1"];
    expect(drops.dropsByVenueId.get("venue-1")).toEqual([]);
    expect(readOptimisticSpills(localStorage)).toEqual([]);
    expect(revoked()).toEqual(expectedPreviews);
    expect(drops.dropMsg).toBeNull();
    await act(async () => { setProviderIdentity("supabase", "preview-account-a"); });
    expect(drops.dropMsg).toBeNull();
    await act(async () => {
      answer(new Response(JSON.stringify({
        status: "adult_check_required", error: "Old account refusal",
        drop: { id: "old-account-price", venueId: "venue-1" },
      }), { status }));
      await pending;
    });
    expect(container.querySelector("button")).toBeNull();
    expect(drops.dropMsg).toBeNull();
    expect(drops.dropsByVenueId.get("venue-1")).toEqual([]);
    expect(readOptimisticSpills(localStorage)).toEqual([]);
    expect(revoked()).toEqual(expectedPreviews);
    expect(io.post).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(revoked()).toEqual(expectedPreviews);
    root = createRoot(container);
  });

  it.each([201, 409])("preserves the new account's pending price and Saving banner after an old response (status: %s)", async (status) => {
    let answerOld!: (response: Response) => void;
    let answerNew!: (response: Response) => void;
    io.post.mockResolvedValue(new Response("{}", { status: 200 }));
    io.post.mockReturnValueOnce(new Promise<Response>((resolve) => { answerOld = resolve; }));
    io.post.mockReturnValueOnce(new Promise<Response>((resolve) => { answerNew = resolve; }));
    await act(async () => {
      drops.pickPhoto("pint", photo("old-pint.jpg"), null);
      drops.pickPhoto("receipt", photo("old-bill.jpg"), null);
      drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale" }));
    });
    let oldPending: void | Promise<void>;
    await act(async () => { oldPending = drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
    await act(async () => { setProviderIdentity("supabase", "preview-account-b"); });
    await act(async () => {
      drops.pickPhoto("pint", photo("new-pint.jpg"), null);
      drops.pickPhoto("receipt", photo("new-bill.jpg"), null);
      drops.setDropForm((form) => ({ ...form, price: "6.00", drink: "Lager" }));
    });
    let newPending: void | Promise<void>;
    await act(async () => { newPending = drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
    const newDrop = drops.dropsByVenueId.get("venue-1")?.[0];
    expect(newDrop?.pintPhotoUrl).toBe("blob:preview-3");
    expect(newDrop?.receiptPhotoUrl).toBe("blob:preview-4");
    const newMessage = drops.dropMsg;
    expect(newMessage?.text).toBe("Cheers. Saving your Pint Drop…");
    await act(async () => {
      answerOld(new Response(JSON.stringify({
        status: "adult_check_required", error: "Old account refusal",
        drop: { id: "old-account-price", venueId: "venue-1" },
      }), { status }));
      await oldPending;
    });
    expect(drops.dropsByVenueId.get("venue-1")).toEqual([newDrop]);
    expect(readOptimisticSpills(localStorage).map(({ drop }) => drop.id)).toEqual([newDrop?.id]);
    expect(drops.dropMsg).toEqual(newMessage);
    expect(revoked()).toEqual(["blob:preview-1", "blob:preview-2"]);
    await act(async () => {
      answerNew(new Response(JSON.stringify({ drop: {
        id: "new-account-price", venueId: "venue-1", handle: "bob", priceGbp: 6,
        drink: "Lager", passedDownNote: "", era: "", vibeTags: [],
        visibility: "public", provenance: "contributor", status: "visible",
        createdAt: new Date().toISOString(), pintPhotoUrl: null, venuePhotoUrl: null,
        priceEvidence: "receipt",
      } }), { status: 201 }));
      await newPending;
    });
    expect(drops.dropsByVenueId.get("venue-1")?.map((drop) => drop.id)).toEqual(["new-account-price"]);
    expect(readOptimisticSpills(localStorage).map(({ drop }) => drop.id)).toEqual(["new-account-price"]);
    expect(revoked()).toEqual(["blob:preview-1", "blob:preview-2", "blob:preview-3", "blob:preview-4"]);
    expect(drops.dropMsg?.ok).toBe(true);
    expect(io.post.mock.calls.filter(([url]) => url === "/api/pint-drops")).toHaveLength(2);
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
      expect(drops.dropMsg).toBeNull();
      expect(io.post).toHaveBeenCalledTimes(2);
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

  it("retries a failed half with its original bill without fetching the preview", async () => {
    // A live bill must survive retry, even when CSP blocks blob fetches.
    const bill = new File(["original bill bytes"], "bill.jpg", { type: "image/jpeg" });
    io.post.mockRejectedValueOnce(new TypeError("Offline"));
    await act(async () => {
      drops.pickPhoto("receipt", bill, null);
      drops.setDropForm((form) => ({ ...form, price: "3.40", drink: "Guinness", measure: "half" }));
    });
    await act(async () => { await drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
    const entry = readOptimisticSpills(localStorage)[0]!;
    expect(entry.drop.optimistic?.state).toBe("failed");
    vi.mocked(fetch).mockRejectedValue(new TypeError("Blocked by connect-src CSP"));

    const form = await buildOptimisticSpillRetryFormData(entry.retry!);
    expect(form.get("measure")).toBe("half");
    expect(form.get("priceGbp")).toBe("3.40");
    const receipt = form.get("receipt_photo") as File;
    expect(receipt.size).toBe(bill.size);
    expect(await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(receipt);
    })).toBe("original bill bytes");

    await act(async () => root.unmount());
    root = createRoot(container);
    await expect(buildOptimisticSpillRetryFormData(entry.retry!)).rejects.toThrow("Photo preview is no longer available.");
  });

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
