import { describe, expect, it } from "vitest";

import { createProviderIdentityRevisionStore } from "@/lib/authProviderRevision";

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

  it("publishes provider authentication readiness without exposing provider identity", () => {
    const store = createProviderIdentityRevisionStore();

    expect(store.authState("clerk")).toBe("unresolved");
    expect(store.setAuthState("clerk", "signed-out")).toBe(1);
    expect(store.authState("clerk")).toBe("signed-out");
    expect(store.setAuthState("clerk", "authenticated")).toBe(2);
    expect(store.authState("clerk")).toBe("authenticated");
  });
});
