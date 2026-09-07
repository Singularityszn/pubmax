// @vitest-environment jsdom
import { act, createElement, useLayoutEffect, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: post }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cheapPintPingQualifyClient", () => ({ notifyCheapPintPingQualified: vi.fn() }));
vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({ user: null, session: null, loading: false, configured: false,
    handle: null, identityResolved: true, getCurrentUserId: () => null }),
}));

import { usePintDrops, type PintDropsState } from "@/components/map/usePintDrops";
import { readOptimisticSpills, writeOptimisticSpills } from "@/lib/optimisticSpillPost";

let state: PintDropsState;
let root: Root;
let container: HTMLDivElement;
let nextUrl = 0;
const revoked = vi.fn();
const file = () => new File([new Uint8Array([255, 216, 255, 42])], "bill.jpg", { type: "image/jpeg" });

function Harness() {
  const current = usePintDrops();
  useLayoutEffect(() => { state = current; }, [current]);
  return null;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  localStorage.setItem("pubmax_handle", "karan");
  post.mockReset();
  revoked.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ drops: [] }) })));
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL() { return `blob:retry-${++nextUrl}`; }
    static revokeObjectURL(url: string) { revoked(url); }
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps the other selected photo alive when another slot changes", async () => {
  await act(async () => state.pickPhoto("receipt", file(), null));
  const receiptUrl = state.receiptPhoto!.previewUrl;
  await act(async () => state.pickPhoto("pint", file(), null));
  expect(revoked).not.toHaveBeenCalledWith(receiptUrl);
  await act(async () => state.removePhoto("pint"));
  expect(revoked).not.toHaveBeenCalledWith(receiptUrl);
  await act(async () => state.removePhoto("receipt"));
  expect(revoked).toHaveBeenCalledWith(receiptUrl);
});

it("retains the failed draft through a malformed success, then clears after a saved drop", async () => {
  const receipt = file();
  await act(async () => {
    state.setComposerOpen(true);
    state.setDropForm({ ...state.dropForm, price: "2.60", drink: "Pale ale", measure: "half" });
    state.pickPhoto("receipt", receipt, null);
  });
  const receiptUrl = state.receiptPhoto!.previewUrl;
  post.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Temporary storage outage" }) });
  await act(async () => state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"));
  expect(state.composerOpen).toBe(true);
  expect(state.dropForm.price).toBe("2.60");
  expect(state.receiptPhoto?.file).toBe(receipt);
  expect(revoked).not.toHaveBeenCalledWith(receiptUrl);

  post.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
  await act(async () => state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"));
  expect(state.receiptPhoto?.file).toBe(receipt);
  expect(state.dropForm.price).toBe("2.60");

  post.mockResolvedValueOnce({ ok: true, json: async () => ({ drop: {
    id: "saved", venueId: "venue-1", handle: "karan", priceGbp: 2.6, drink: "Pale ale",
    measure: "half", passedDownNote: "", era: "", visibility: "public",
    status: "visible", provenance: "contributor", createdAt: new Date().toISOString(),
    pintPhotoUrl: null, venuePhotoUrl: null, receiptPhotoUrl: "/receipt.jpg",
  } }) });
  await act(async () => state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"));
  expect(state.composerOpen).toBe(false);
  expect(state.receiptPhoto).toBeNull();
  expect(state.dropForm.price).toBe("");
  expect(revoked).toHaveBeenCalledWith(receiptUrl);
  expect(readOptimisticSpills(localStorage)).toHaveLength(1);
  expect(readOptimisticSpills(localStorage)[0].retry).toBeUndefined();
});

it("keeps the failed record's photo alive when the composer unmounts", async () => {
  await act(async () => {
    state.setDropForm({ ...state.dropForm, price: "5.80" });
    state.pickPhoto("receipt", file(), null);
  });
  post.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Temporary outage" }) });
  await act(async () => state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"));
  const retryUrl = readOptimisticSpills(localStorage)[0].retry?.receiptPhotoUrl;
  expect(retryUrl).toMatch(/^blob:/);
  await act(async () => root.unmount());
  expect(revoked).not.toHaveBeenCalledWith(retryUrl);
  writeOptimisticSpills(localStorage, []);
  expect(revoked).toHaveBeenCalledWith(retryUrl);
});

it("keeps the pending draft and refuses a second tap until the first request settles", async () => {
  const receipt = file();
  await act(async () => {
    state.setComposerOpen(true);
    state.setDropForm({ ...state.dropForm, price: "5.80" });
    state.pickPhoto("receipt", receipt, null);
  });
  let finish!: (response: unknown) => void;
  post.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  let pending: ReturnType<PintDropsState["submitDrop"]>;
  await act(async () => {
    pending = state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1");
    void state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1");
  });
  expect(post).toHaveBeenCalledTimes(1);
  expect(state.submitting).toBe(true);
  expect(state.composerOpen).toBe(true);
  expect(state.receiptPhoto?.file).toBe(receipt);
  expect(revoked).not.toHaveBeenCalledWith(state.receiptPhoto!.previewUrl);
  await act(async () => {
    finish({ ok: false, json: async () => ({ error: "Temporary outage" }) });
    await pending;
  });
  expect(state.submitting).toBe(false);
  const retryUrl = readOptimisticSpills(localStorage)[0].retry!.receiptPhotoUrl;
  await act(async () => state.resetComposer());
  expect(readOptimisticSpills(localStorage)).toEqual([]);
  expect(revoked).toHaveBeenCalledWith(retryUrl);
});
