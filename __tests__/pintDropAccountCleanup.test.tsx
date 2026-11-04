// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The hook, action fetch and account abort signal are real. Authentication,
// tokens, analytics and the HTTP transport are boundary doubles.
const auth = vi.hoisted(() => ({ id: "pending-account-a", handle: "alice" }));
vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({
    user: { id: auth.id },
    session: { user: { id: auth.id }, access_token: "disposable-token" },
    loading: false, configured: true, handle: auth.handle, identityResolved: true,
    getCurrentUserId: () => auth.id,
  }),
}));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "disposable-token" }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import { writeActiveRoundCode } from "@/lib/activeRound";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import { publishAuthActionState } from "@/lib/authedFetch";
import { usePintDrops, type DropWithPhotos, type PintDropsState } from "@/components/map/usePintDrops";
import { readOptimisticSpills, writeOptimisticSpills } from "@/lib/optimisticSpillPost";

type PriceRequest = {
  signal: AbortSignal;
  body: FormData;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
};

let container: HTMLDivElement;
let root: Root;
let drops: PintDropsState;
let aborted: number;
let minted: number;
let requests: PriceRequest[];
let holdRound: boolean;
let answerRound: ((response: Response) => void) | undefined;

function serverDrop(id: string): DropWithPhotos {
  return {
    id, venueId: "venue-1", handle: "alice", priceGbp: 5.5,
    drink: "Pale ale", passedDownNote: "", era: "", vibeTags: [],
    visibility: "public", provenance: "contributor", status: "visible",
    createdAt: "2026-11-04T12:00:00.000Z", pintPhotoUrl: null, venuePhotoUrl: null,
  };
}

const publicDrop = serverDrop("existing-public-price");
const otherPending: DropWithPhotos = {
  ...serverDrop("optimistic-other-request"),
  optimistic: {
    state: "pending", message: "Posting Spill", uploadProgress: null,
    canRetry: false, clientRequestId: "other-request",
  },
};

function Probe() {
  const state = usePintDrops();
  useEffect(() => { drops = state; }, [state]);
  return createElement("p", { role: "status" }, state.dropMsg?.text);
}

function photo(name: string): File {
  return new File([new Uint8Array(8)], name, { type: "image/jpeg" });
}

const revoked = () => vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url);
const mapIds = () => drops.dropsByVenueId.get("venue-1")?.map((drop) => drop.id);
const storedIds = () => readOptimisticSpills(localStorage).map(({ drop }) => drop.id);

function switchAccount(id: string, handle: string) {
  auth.id = id;
  auth.handle = handle;
  setProviderIdentity("supabase", id);
}

async function startPrice(withBill: boolean, withPint = true) {
  await act(async () => {
    if (withPint) drops.pickPhoto("pint", photo("pint.jpg"), null);
    if (withBill) drops.pickPhoto("receipt", photo("bill.jpg"), null);
    drops.setDropForm((form) => ({ ...form, price: "5.50", drink: "Pale ale" }));
  });
  let pending: void | Promise<void>;
  await act(async () => { pending = drops.submitDrop({ preventDefault() {} } as never, "venue-1"); });
  return { pending: pending!, optimistic: drops.dropsByVenueId.get("venue-1")![0] };
}

beforeEach(async () => {
  auth.id = "pending-account-a";
  auth.handle = "alice";
  setProviderIdentity("supabase", auth.id);
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("pubmax_handle", "alice");
  writeOptimisticSpills(localStorage, [
    { clientRequestId: "existing-saved-request", drop: publicDrop },
    { clientRequestId: "other-request", drop: otherPending },
  ]);
  aborted = 0;
  minted = 0;
  requests = [];
  holdRound = false;
  answerRound = undefined;
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => `blob:pending-preview-${++minted}`),
    revokeObjectURL: vi.fn(),
  }));
  vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer disposable-token");
      if (String(url) === "/api/pint-drops") {
        return new Promise<Response>((resolve, reject) => {
          const signal = init.signal!;
          requests.push({ signal, body: init.body as FormData, resolve, reject });
          signal.addEventListener("abort", () => {
            aborted += 1;
            reject(signal.reason);
          }, { once: true });
        });
      }
      if (String(url).startsWith("/api/rounds/") && holdRound &&
          JSON.parse(String(init.body)).action === "addStop") {
        return new Promise<Response>((resolve) => { answerRound = resolve; });
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ drops: [publicDrop, otherPending] }), { status: 200 }));
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(Probe)); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  publishAuthActionState({ status: "unknown", identityResolved: false });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([false, true])("disposes the abandoned account's pending price after a real abort (bill: %s)", async (withBill) => {
  const { pending, optimistic } = await startPrice(withBill);
  expect(requests).toHaveLength(1);
  expect(requests[0].signal.aborted).toBe(false);
  expect(requests[0].body.has("receipt_photo")).toBe(withBill);
  expect(optimistic.optimistic?.state).toBe("uploading");
  expect(optimistic.priceEvidence).toBe(withBill ? "receipt" : "unchecked");
  expect(storedIds()).toContain(optimistic.id);
  expect(container.textContent).toBe("Cheers. Saving your Pint Drop…");
  expect(revoked()).toEqual([]);

  await act(async () => {
    switchAccount("pending-account-b", "bob");
    switchAccount("pending-account-a", "alice");
    await pending;
  });
  expect(aborted).toBe(1);
  expect(requests[0].signal.aborted).toBe(true);
  expect(mapIds()).toEqual(["existing-public-price", "optimistic-other-request"]);
  expect(storedIds()).toEqual(["existing-public-price", "optimistic-other-request"]);
  expect(drops.dropMsg).toBeNull();
  expect(container.textContent).toBe("");
  const expectedPreviews = withBill
    ? ["blob:pending-preview-1", "blob:pending-preview-2"]
    : ["blob:pending-preview-1"];
  expect(revoked()).toEqual(expectedPreviews);
  expect(requests).toHaveLength(1);
  await act(async () => root.unmount());
  expect(revoked()).toEqual(expectedPreviews);
  root = createRoot(container);
});

it("removes a pending price with no photo after the account changes", async () => {
  const { pending, optimistic } = await startPrice(false, false);
  expect(optimistic.optimistic?.state).toBe("pending");
  await act(async () => {
    switchAccount("pending-account-b", "bob");
    await pending;
  });
  expect(aborted).toBe(1);
  expect(mapIds()).toEqual(["existing-public-price", "optimistic-other-request"]);
  expect(storedIds()).toEqual(["existing-public-price", "optimistic-other-request"]);
  expect(revoked()).toEqual([]);
  expect(drops.dropMsg).toBeNull();
  expect(requests).toHaveLength(1);
});

it("releases only handed-off previews and keeps the unsubmitted photo slot", async () => {
  const { pending } = await startPrice(false);
  await act(async () => { drops.pickPhoto("venue", photo("next-venue.jpg"), null); });
  await act(async () => {
    switchAccount("pending-account-b", "bob");
    await pending;
  });
  expect(revoked()).toEqual(["blob:pending-preview-1"]);
  expect(drops.venuePhoto?.previewUrl).toBe("blob:pending-preview-2");
  await act(async () => root.unmount());
  expect(revoked()).toEqual(["blob:pending-preview-1", "blob:pending-preview-2"]);
  root = createRoot(container);
});

it.each([false, true])("preserves a saved price when the account changes during the Round append (bill: %s)", async (withBill) => {
  writeActiveRoundCode("JXKQ7M");
  holdRound = true;
  const { pending, optimistic } = await startPrice(withBill);
  const saved = { ...serverDrop("server-saved-price"), priceEvidence: withBill ? "receipt" : "unchecked" };
  await act(async () => {
    requests[0].resolve(new Response(JSON.stringify({ drop: saved }), { status: 201 }));
  });
  expect(answerRound).toBeTypeOf("function");
  expect(mapIds()).toEqual(["server-saved-price", "existing-public-price", "optimistic-other-request"]);
  const savedEntry = readOptimisticSpills(localStorage).find(({ drop }) => drop.id === "server-saved-price");
  expect(savedEntry?.clientRequestId).toBe(optimistic.optimistic?.clientRequestId);
  expect(savedEntry?.drop.optimistic).toBeUndefined();
  const released = revoked();
  expect(released).toHaveLength(withBill ? 2 : 1);

  await act(async () => { switchAccount("pending-account-b", "bob"); });
  expect(mapIds()).toEqual(["server-saved-price", "existing-public-price", "optimistic-other-request"]);
  expect(storedIds()).toEqual(["server-saved-price", "existing-public-price", "optimistic-other-request"]);
  expect(drops.dropMsg).toBeNull();
  await act(async () => {
    answerRound!(new Response("{}", { status: 200 }));
    await pending;
  });
  expect(drops.dropsByVenueId.get("venue-1")?.[0]).toEqual(saved);
  expect(readOptimisticSpills(localStorage)[0]).toEqual(savedEntry);
  expect(revoked()).toEqual(released);
  expect(drops.dropMsg).toBeNull();
  expect(requests).toHaveLength(1);
});

it("keeps a same-account transport failure retryable without retrying automatically", async () => {
  const { pending, optimistic } = await startPrice(true);
  await act(async () => {
    requests[0].reject(new TypeError("Network failed"));
    await pending;
  });
  expect(drops.dropsByVenueId.get("venue-1")?.[0]).toMatchObject({
    id: optimistic.id, optimistic: { state: "failed", canRetry: true },
  });
  expect(readOptimisticSpills(localStorage)[0].drop).toMatchObject({
    id: optimistic.id, optimistic: { state: "failed", canRetry: true },
  });
  expect(drops.dropMsg?.text).toBe("Network or storage error. Try again.");
  expect(revoked()).toEqual([]);
  expect(requests).toHaveLength(1);
});
