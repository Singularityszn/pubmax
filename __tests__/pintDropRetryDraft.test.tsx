// @vitest-environment jsdom
import { act, createElement, useLayoutEffect, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: post }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cheapPintPingQualifyClient", () => ({ notifyCheapPintPingQualified: vi.fn() }));
import { AuthContext, useAuth, type AuthContextValue } from "@/components/auth/authContext";
import { useVenueDraft } from "@/components/map/composer/useVenueDraft";

import { usePintDrops, type PintDropsState } from "@/components/map/usePintDrops";
import { readOptimisticSpills, writeOptimisticSpills } from "@/lib/optimisticSpillPost";

let state: PintDropsState;
let root: Root;
let container: HTMLDivElement;
let nextUrl = 0;
const revoked = vi.fn();
const file = () => new File([new Uint8Array([255, 216, 255, 42])], "bill.jpg", { type: "image/jpeg" });
let currentAccount: string | null = null;
const getCurrentUserId = () => currentAccount;

function DraftLifecycle({ current, venueId }: { current: PintDropsState; venueId: string }) {
  useVenueDraft({ ...current, venueId, transientVoiceNoteBaseline: null });
  return createElement("input", { "aria-label": "Price", value: current.dropForm.price, readOnly: true });
}

function AccountBoundary({ accountId = null, hydrate = false, token = "initial", authState, venueId = "venue-1" }: {
  accountId?: string | null; hydrate?: boolean; token?: string;
  authState?: AuthContextValue["providerAuthState"];
  venueId?: string;
}) {
  const fallback = useAuth();
  const user = accountId ? { id: accountId } as AuthContextValue["user"] : null;
  const session = user ? { user, access_token: `test-${accountId}-${token}` } as AuthContextValue["session"] : null;
  return createElement(AuthContext.Provider, { value: { ...fallback, user, session,
    configured: Boolean(accountId), identityResolved: true,
    providerAuthState: authState ?? (accountId ? "authenticated" : "signed-out"),
    loading: authState === "unresolved",
    handle: accountId ? accountId.toLowerCase() : null, getCurrentUserId,
  } }, createElement(Harness, { hydrate, venueId }));
}

function Harness({ hydrate = false, venueId = "venue-1" }: { hydrate?: boolean; venueId?: string }) {
  const current = usePintDrops();
  useLayoutEffect(() => { state = current; }, [current]);
  return hydrate ? createElement(DraftLifecycle, { current, venueId }) : null;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  currentAccount = null;
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
  await act(async () => root.render(createElement(AccountBoundary)));
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
  expect(state.dropsByVenueId.get("venue-1") ?? []).toEqual([]);

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
  expect(state.dropsByVenueId.get("venue-1") ?? []).toEqual([]);
  expect(revoked).toHaveBeenCalledWith(retryUrl);
});

it.each(["price", "bill", "measure", "visibility", "vibes", "handle", "close/reopen"])("does not clear a newer %s change after an old success", async (change) => {
  await act(async () => {
    state.setComposerOpen(true);
    state.setDropForm({ ...state.dropForm, price: "5.80" });
    state.pickPhoto("receipt", file(), null);
  });
  let finish!: (response: unknown) => void;
  post.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  let pending: ReturnType<PintDropsState["submitDrop"]>;
  await act(async () => { pending = state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"); });
  const newerReceipt = file();
  await act(async () => {
    if (change === "price") state.setDropForm({ ...state.dropForm, price: "6.20" });
    if (change === "bill") state.pickPhoto("receipt", newerReceipt, null);
    if (change === "measure") state.setDropForm({ ...state.dropForm, measure: "half" });
    if (change === "visibility") state.setVisibility("anonymous");
    if (change === "vibes") state.toggleVibeTag("proper");
    if (change === "handle") state.setHandle("other");
    if (change === "close/reopen") {
      state.closeComposer();
      state.setComposerOpen(true);
    }
  });
  const edited = state;
  await act(async () => {
    finish({ ok: true, json: async () => ({ drop: { id: "old-saved", venueId: "venue-1" } }) });
    await pending;
  });
  expect(state.dropForm).toEqual(edited.dropForm);
  expect(state.receiptPhoto?.file).toBe(edited.receiptPhoto?.file);
  expect(state.visibility).toBe(edited.visibility);
  expect(state.vibeTags).toEqual(edited.vibeTags);
  expect(state.handle).toBe(edited.handle);
  expect(state.composerOpen).toBe(true);
  expect(state.dropMsg?.ok).not.toBe(true);
});

it.each([true, false])("keeps the old request record across a venue reset, success=%s", async (ok) => {
  await act(async () => {
    state.setComposerOpen(true);
    state.setDropForm({ ...state.dropForm, price: "5.80" });
    state.pickPhoto("receipt", file(), null);
  });
  let finish!: (response: unknown) => void;
  post.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  let pending: ReturnType<PintDropsState["submitDrop"]>;
  await act(async () => { pending = state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"); });
  const oldRecord = readOptimisticSpills(localStorage)[0];
  await act(async () => {
    state.closeComposer();
    state.resetComposer();
    state.setDropForm({ ...state.dropForm, price: "7.40", drink: "New venue" });
    state.setComposerOpen(true);
  });
  expect(readOptimisticSpills(localStorage)[0]?.clientRequestId).toBe(oldRecord.clientRequestId);
  expect(revoked).not.toHaveBeenCalledWith(oldRecord.retry!.receiptPhotoUrl);
  await act(async () => {
    finish({ ok, json: async () => ok ? { drop: { id: "old-saved", venueId: "venue-1" } } : { error: "Old venue failed" } });
    await pending;
  });
  expect(state.dropForm.price).toBe("7.40");
  expect(state.composerOpen).toBe(true);
  expect(state.dropMsg).toBeNull();
  const settled = readOptimisticSpills(localStorage)[0];
  expect(settled.drop.id).toBe(ok ? "old-saved" : oldRecord.drop.id);
  if (!ok) {
    expect(settled.drop.optimistic?.state).toBe("failed");
    expect(settled.retry?.receiptPhotoUrl).toBe(oldRecord.retry?.receiptPhotoUrl);
    expect(revoked).not.toHaveBeenCalledWith(oldRecord.retry!.receiptPhotoUrl);
  }
});

it.each(["pending", "failed"])("discards a %s Legacy row with its draft across a failed venue refresh", async (phase) => {
  await act(async () => {
    state.setComposerOpen(true);
    state.setVisibility("legacy");
    state.setDropForm({ ...state.dropForm, price: "5.80" });
    state.pickPhoto("receipt", file(), null);
    state.pickPhoto("pint", file(), null);
  });
  const urls = [state.receiptPhoto!.previewUrl, state.pintPhoto!.previewUrl];
  let finish!: (response: unknown) => void;
  post.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  let pending: ReturnType<PintDropsState["submitDrop"]>;
  await act(async () => { pending = state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"); });
  expect(state.dropsByVenueId.get("venue-1")).toHaveLength(1);
  expect(readOptimisticSpills(localStorage)).toEqual([]);
  const fail = async () => {
    finish({ ok: false, json: async () => ({ error: "Temporary outage" }) });
    await pending;
  };
  if (phase === "failed") await act(fail);
  // Venue hydration discards the old composer before loading the next draft.
  await act(async () => {
    state.closeComposer();
    state.resetComposer();
    state.setDropForm({ ...state.dropForm, price: "7.40" });
  });
  if (phase === "pending") await act(fail);
  vi.mocked(fetch).mockRejectedValue(new Error("Venue read unavailable"));
  await act(async () => { state.refreshVenueDrops("venue-1"); });
  expect(state.venueDropStatus.get("venue-1")).toBe("unavailable");
  expect(state.dropsByVenueId.get("venue-1") ?? []).toEqual([]);
  expect(readOptimisticSpills(localStorage)).toEqual([]);
  for (const url of urls) expect(revoked).toHaveBeenCalledWith(url);
  expect(state.dropForm.price).toBe("7.40");
  expect(state.dropMsg).toBeNull();
});

it.each(["pending", "failed"])("clears A's %s receipt draft when the mounted account boundary switches to B", async (phase) => {
  currentAccount = "A";
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "A", hydrate: true })));
  await act(async () => {
    state.setComposerOpen(true);
    state.setDropForm({ ...state.dropForm, price: "5.80", drink: "A's drink" });
    state.pickPhoto("receipt", file(), null);
    state.pickPhoto("pint", file(), null);
  });
  const originalUrls = [state.receiptPhoto!.previewUrl, state.pintPhoto!.previewUrl];
  let finish!: (response: unknown) => void;
  post.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  let pending: ReturnType<PintDropsState["submitDrop"]>;
  await act(async () => { pending = state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"); });
  const fail = async () => {
    finish({ ok: false, json: async () => ({ error: "A's outage" }) });
    await pending;
  };
  if (phase === "failed") await act(fail);
  const oldSubmit = state.submitDrop;
  const retry = readOptimisticSpills(localStorage)[0].retry!;
  currentAccount = "B";
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "B", hydrate: true })));
  if (phase === "pending") await act(fail);
  expect(state.accountHandle).toBe("b");
  expect(container.querySelector("input")?.value).toBe("");
  expect(state.receiptPhoto).toBeNull();
  expect(state.pintPhoto).toBeNull();
  expect(state.composerOpen).toBe(false);
  expect(readOptimisticSpills(localStorage)).toEqual([]);
  expect(state.dropsByVenueId.get("venue-1") ?? []).toEqual([]);
  for (const url of originalUrls) expect(revoked).toHaveBeenCalledWith(url);
  expect(revoked).toHaveBeenCalledWith(retry.receiptPhotoUrl);
  expect(revoked).toHaveBeenCalledWith(retry.pintPhotoUrl);
  await act(async () => state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"));
  expect(post).toHaveBeenCalledTimes(1);
  await act(async () => oldSubmit({ preventDefault() {} } as FormEvent, "venue-1"));
  expect(post).toHaveBeenCalledTimes(1);
  const newBill = file();
  await act(async () => {
    state.setDropForm({ ...state.dropForm, price: "6.40" });
    state.pickPhoto("receipt", newBill, null);
  });
  post.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "B's outage" }) });
  await act(async () => state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"));
  const body = post.mock.calls[1][1].body as FormData;
  expect(body.get("handle")).toBe("b");
  expect(body.get("receipt_photo")).toBe(newBill);
  expect(body.get("pint_photo")).toBeNull();
});

it("refuses a retained draft submit after the live account changes but before React effects run", async () => {
  currentAccount = "A";
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "A", hydrate: true })));
  await act(async () => {
    state.setDropForm({ ...state.dropForm, price: "5.80" });
    state.pickPhoto("receipt", file(), null);
  });
  post.mockResolvedValue({ ok: false, json: async () => ({ error: "Outage" }) });
  await act(async () => state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"));
  currentAccount = "B";
  // AuthProvider updates its live account ref before the new context commits.
  await act(async () => state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"));
  expect(post).toHaveBeenCalledTimes(1);
});

it("retains the same account's draft across a token refresh", async () => {
  currentAccount = "A";
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "A", hydrate: true })));
  const receipt = file();
  await act(async () => {
    state.setComposerOpen(true);
    state.setDropForm({ ...state.dropForm, price: "5.80" });
    state.pickPhoto("receipt", receipt, null);
  });
  const url = state.receiptPhoto!.previewUrl;
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "A", hydrate: true, token: "refreshed" })));
  expect(container.querySelector("input")?.value).toBe("5.80");
  expect(state.receiptPhoto?.file).toBe(receipt);
  expect(state.composerOpen).toBe(true);
  expect(revoked).not.toHaveBeenCalledWith(url);
});

it.each(["unresolved", "unavailable"] as const)("keeps A's draft through %s auth, then clears it on confirmed sign-out", async (authState) => {
  currentAccount = "A";
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "A", hydrate: true })));
  const receipt = file();
  await act(async () => {
    state.setComposerOpen(true);
    state.setDropForm({ ...state.dropForm, price: "5.80" });
    state.pickPhoto("receipt", receipt, null);
  });
  const url = state.receiptPhoto!.previewUrl;
  currentAccount = null;
  await act(async () => root.render(createElement(AccountBoundary, { authState, hydrate: true })));
  expect(state.receiptPhoto?.file).toBe(receipt);
  expect(state.dropForm.price).toBe("5.80");
  expect(revoked).not.toHaveBeenCalledWith(url);
  await act(async () => state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"));
  expect(post).not.toHaveBeenCalled();
  currentAccount = "A";
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "A", hydrate: true, token: "restored" })));
  expect(state.receiptPhoto?.file).toBe(receipt);
  expect(state.dropForm.price).toBe("5.80");
  currentAccount = null;
  await act(async () => root.render(createElement(AccountBoundary, { hydrate: true })));
  expect(state.receiptPhoto).toBeNull();
  expect(state.dropForm.price).toBe("");
  expect(revoked).toHaveBeenCalledWith(url);
});

it.each([true, false])("does not restore A's private row after switching to B, success=%s", async (ok) => {
  currentAccount = "A";
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "A", hydrate: true })));
  await act(async () => {
    state.setVisibility("legacy");
    state.setDropForm({ ...state.dropForm, price: "5.80" });
    state.pickPhoto("receipt", file(), null);
  });
  let finish!: (response: unknown) => void;
  post.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  let pending: ReturnType<PintDropsState["submitDrop"]>;
  await act(async () => { pending = state.submitDrop({ preventDefault() {} } as FormEvent, "venue-1"); });
  expect(state.dropsByVenueId.get("venue-1")).toHaveLength(1);
  currentAccount = "B";
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "B", hydrate: true })));
  expect(state.dropsByVenueId.get("venue-1") ?? []).toEqual([]);
  await act(async () => {
    finish({ ok, json: async () => ok ? { drop: { id: "A-private", venueId: "venue-1", visibility: "legacy" } } : { error: "A's outage" } });
    await pending;
  });
  expect(state.dropsByVenueId.get("venue-1") ?? []).toEqual([]);
  expect(readOptimisticSpills(localStorage)).toEqual([]);
  expect(state.dropMsg).toBeNull();
});

it("does not hydrate A's saved fields when B returns to an earlier venue", async () => {
  currentAccount = "A";
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "A", hydrate: true })));
  await act(async () => state.setDropForm({ ...state.dropForm, price: "5.80", note: "A's private note" }));
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "A", hydrate: true, venueId: "venue-2" })));
  await act(async () => state.setDropForm({ ...state.dropForm, price: "7.40" }));
  sessionStorage.setItem("unrelated", "keep");
  currentAccount = "B";
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "B", hydrate: true, venueId: "venue-2" })));
  await act(async () => root.render(createElement(AccountBoundary, { accountId: "B", hydrate: true })));
  expect(container.querySelector("input")?.value).toBe("");
  expect(state.dropForm.note).toBe("");
  expect(sessionStorage.getItem("unrelated")).toBe("keep");
});
