import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProviderIdentityRevisionStore,
  resolveSupabaseAuthState,
  type ProviderAuthState,
} from "@/lib/authProviderRevision";

afterEach(() => {
  vi.useRealTimers();
});

describe("provider identity revision", () => {
  it("increments only when the combined provider identity changes", () => {
    const store = createProviderIdentityRevisionStore();

    expect(store.read()).toBe(0);
    expect(store.set("clerk", "clerk-actor-a")).toBe(1);
    expect(store.set("clerk", "clerk-actor-a")).toBe(1);
    expect(store.set("supabase", "supabase-actor-a")).toBe(2);
    expect(store.set("clerk", "clerk-actor-b")).toBe(3);
    expect(store.set("clerk", null)).toBe(4);
  });

  it("notifies subscribers after either provider changes", () => {
    const store = createProviderIdentityRevisionStore();
    const revisions: number[] = [];
    const unsubscribe = store.subscribe(() => revisions.push(store.read()));

    store.set("clerk", "clerk-actor-a");
    store.set("supabase", "supabase-actor-a");
    store.set("supabase", "supabase-actor-a");
    unsubscribe();
    store.set("clerk", null);

    expect(revisions).toEqual([1, 2]);
  });

  it("aborts the old provider revision signal and rotates to a live signal", () => {
    const store = createProviderIdentityRevisionStore();
    const before = store.signal();
    const callbackOrder: string[] = [];
    const signalsAtNotification: AbortSignal[] = [];
    before.addEventListener("abort", () => callbackOrder.push("abort"), {
      once: true,
    });
    store.subscribe(() => {
      callbackOrder.push("notify");
      signalsAtNotification.push(store.signal());
      expect(before.aborted).toBe(true);
      expect(store.signal().aborted).toBe(false);
    });
    expect(before.aborted).toBe(false);

    store.set("supabase", "supabase-actor-a");

    const after = store.signal();
    expect(callbackOrder).toEqual(["abort", "notify"]);
    expect(signalsAtNotification).toEqual([after]);
    expect(before.aborted).toBe(true);
    expect(before.reason).toMatchObject({ name: "AbortError" });
    expect(after).not.toBe(before);
    expect(after.aborted).toBe(false);

    store.set("supabase", "supabase-actor-a");
    expect(store.signal()).toBe(after);
  });

  it("rotates the account binding for the first and later account changes", () => {
    const store = createProviderIdentityRevisionStore();
    const initialSignal = store.accountSignal();

    expect(store.accountRevision()).toBe(0);
    store.set("supabase", "supabase-actor-a");
    expect(initialSignal.aborted).toBe(true);
    expect(store.accountRevision()).toBe(1);

    const accountASignal = store.accountSignal();

    store.set("supabase", "supabase-actor-b");

    expect(accountASignal.aborted).toBe(true);
    expect(store.accountRevision()).toBe(2);
    expect(store.accountSignal().aborted).toBe(false);
  });

  it.each([
    ["unresolved settling to A", [["auth", "authenticated"], ["id", "a"]], false],
    ["unresolved settling to signed out", [["auth", "signed-out"]], false],
    ["unavailable settling to A", [["auth", "unavailable"], ["auth", "authenticated"], ["id", "a"]], false],
    ["A rechecking and settling to A again", [["auth", "authenticated"], ["id", "a"], ["auth", "unresolved"], ["auth", "authenticated"]], false],
    ["A to B", [["auth", "authenticated"], ["id", "a"], ["id", "b"]], true],
    ["A to signed out", [["auth", "authenticated"], ["id", "a"], ["auth", "signed-out"], ["id", null]], true],
    ["signed out to A", [["auth", "signed-out"], ["auth", "authenticated"], ["id", "a"]], true],
    ["A to unresolved to B", [["auth", "authenticated"], ["id", "a"], ["auth", "unresolved"], ["id", null], ["auth", "authenticated"], ["id", "b"]], true],
  ] as const)("aborts the answered account binding only on a real change: %s", (_name, steps, aborted) => {
    const store = createProviderIdentityRevisionStore();
    const started = store.answeredAccountSignal();
    for (const [kind, value] of steps) {
      if (kind === "auth") store.setAuthState("supabase", value as ProviderAuthState);
      else store.set("supabase", value);
    }
    expect(started.aborted).toBe(aborted);
    expect(store.answeredAccountSignal().aborted).toBe(false);
  });

  it("keeps the answered account binding when a second provider gives its first answer", () => {
    const store = createProviderIdentityRevisionStore();
    store.setAuthState("supabase", "authenticated");
    store.set("supabase", "supabase-actor-a");
    const started = store.answeredAccountSignal();
    store.setAuthState("clerk", "authenticated");
    store.set("clerk", "clerk-actor-a");
    expect(started.aborted).toBe(false);
    store.set("clerk", "clerk-actor-b");
    expect(started.aborted).toBe(true);
  });

  it("publishes provider authentication readiness without exposing provider identity", () => {
    const store = createProviderIdentityRevisionStore();

    expect(store.authState("clerk")).toBe("unresolved");
    expect(store.setAuthState("clerk", "signed-out")).toBe(1);
    expect(store.authState("clerk")).toBe("signed-out");
    expect(store.setAuthState("clerk", "authenticated")).toBe(2);
    expect(store.authState("clerk")).toBe("authenticated");
  });

  it("checks session ownership within its provider without publishing an identity", () => {
    const store = createProviderIdentityRevisionStore();
    expect(store.ownsSession("supabase", null)).toBe(false);
    expect(store.ownsSession("supabase", "account-a")).toBe(false);
    store.set("clerk", "account-a");
    expect(store.ownsSession("supabase", "account-a")).toBe(false);
    store.set("supabase", "account-b");
    expect(store.ownsSession("supabase", "account-a")).toBe(false);
    expect(store.ownsSession("supabase", "account-b")).toBe(true);
    expect(store.ownsSession("clerk", "account-a")).toBe(true);
    store.set("supabase", null);
    expect(store.ownsSession("supabase", "account-b")).toBe(false);
  });

  it("does not publish an auth answer for a null INITIAL_SESSION event", () => {
    expect(resolveSupabaseAuthState("initial-session", false, null)).toBeNull();
  });

  it("settles signed-out after bootstrap proves no account exists", () => {
    expect(resolveSupabaseAuthState("bootstrap", false, null)).toBe("signed-out");
  });

  it("keeps a timed-out auth read unavailable instead of claiming signed out", () => {
    expect(resolveSupabaseAuthState("timeout", false, null)).toBe("unavailable");
  });

  it("does not let a bootstrap timeout replace an authenticated session", () => {
    vi.useFakeTimers();
    let state: ProviderAuthState = "unresolved";
    let currentUserId: string | null = null;

    const timeout = setTimeout(() => {
      const next = resolveSupabaseAuthState("timeout", currentUserId !== null, currentUserId);
      if (next) state = next;
    }, 20_000);

    const sessionEvent = resolveSupabaseAuthState("auth-event", true, "supabase-user-a");
    currentUserId = "supabase-user-a";
    if (sessionEvent) state = sessionEvent;
    vi.advanceTimersByTime(20_000);

    expect(state).toBe("authenticated");
    clearTimeout(timeout);
  });
});
