import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearPersistentPlanMutationKey, persistentPlanMutationKey, preparePlanMutationKey, rememberPlanMutationKey } from "@/lib/planMutationKey";
import { readProviderAccountSignal, setProviderIdentity } from "@/lib/authProviderRevision";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

beforeEach(() => vi.stubGlobal("sessionStorage", storage()));
afterEach(() => vi.unstubAllGlobals());

describe("persistent Plan mutation keys", () => {
  it("does not overwrite the next account's key when the provider changes during hashing", async () => {
    setProviderIdentity("supabase", "account-a");
    const lifetime = new AbortController();
    const signal = AbortSignal.any([lifetime.signal, readProviderAccountSignal()]);
    const pending = persistentPlanMutationKey("create", { title: "Account A" }, signal);
    setProviderIdentity("supabase", "account-b");
    sessionStorage.setItem("pubmaxx:plan-mutation:v1:create", "account-b-key");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(sessionStorage.getItem("pubmaxx:plan-mutation:v1:create")).toBe("account-b-key");
    expect(lifetime.signal.aborted).toBe(false);
    setProviderIdentity("supabase", null);
  });

  it("does not overwrite the next account's key after cancellation during hashing", async () => {
    const controller = new AbortController();
    const pending = persistentPlanMutationKey("create", { title: "Account A" }, controller.signal);
    controller.abort();
    sessionStorage.setItem("pubmaxx:plan-mutation:v1:create", "account-b-key");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(sessionStorage.getItem("pubmaxx:plan-mutation:v1:create")).toBe("account-b-key");
  });

  it("reuses one key for the same intent across retries and replaces it when intent changes", async () => {
    const first = await persistentPlanMutationKey("create", { title: "Friday", stops: ["a", "b"] });
    const retry = await persistentPlanMutationKey("create", { title: "Friday", stops: ["a", "b"] });
    const changed = await persistentPlanMutationKey("create", { title: "Saturday", stops: ["a", "b"] });
    expect(retry).toBe(first);
    expect(changed).not.toBe(first);
  });

  it.each([
    { title: "Saturday" },
    { creatorName: "Alex" },
    { startTime: "2026-11-03T20:00:00.000Z" },
    { stops: [{ venueId: "b", venueName: "Pub B" }] },
    { context: { nightArea: "Soho" } },
    { groundingProof: "new-proof" },
    { anchor: { venueId: "b", source: "near", outcome: "route" } },
    { cityId: "manchester" },
  ])("detects changed request fields for a spent proof key: %j", async (change) => {
    const payload = {
      title: "Friday", creatorName: "Sam", startTime: "2026-11-03T19:00:00.000Z",
      stops: [{ venueId: "a", venueName: "Pub A" }], context: { nightArea: "Clapham" },
      groundingProof: "signed-proof", anchor: { venueId: "a", source: "near", outcome: "route" }, cityId: "london",
    };
    const boundKey = "generated-key";
    const first = await preparePlanMutationKey("create", payload, { boundKey });
    expect(first.key).toBe(boundKey);
    expect((await preparePlanMutationKey("create", { ...payload, ...change }, { boundKey })).key).toBe(boundKey);
    rememberPlanMutationKey("create", first, boundKey);
    expect((await preparePlanMutationKey("create", payload, { boundKey })).key).toBe(boundKey);
    expect((await preparePlanMutationKey("create", { ...payload, ...change }, { boundKey })).key).not.toBe(boundKey);
  });

  it("retains the fingerprint of an earlier proof key after another route is sent", async () => {
    const first = await preparePlanMutationKey("create", { title: "Friday" }, { boundKey: "first-proof-key" });
    rememberPlanMutationKey("create", first, "first-proof-key");
    const second = await preparePlanMutationKey("create", { title: "Saturday" }, { boundKey: "second-proof-key", previous: first });
    rememberPlanMutationKey("create", second, "second-proof-key");
    const retry = await preparePlanMutationKey("create", { title: "Sunday" }, { boundKey: "first-proof-key", previous: second });
    expect(retry.key).not.toBe("first-proof-key");
  });

  it("clears only the matching completed operation", async () => {
    const key = await persistentPlanMutationKey("join:plan-1", { name: "Crew", inviteToken: null });
    clearPersistentPlanMutationKey("join:plan-1", "different-key");
    expect(await persistentPlanMutationKey("join:plan-1", { name: "Crew", inviteToken: null })).toBe(key);
    clearPersistentPlanMutationKey("join:plan-1", key);
    expect(await persistentPlanMutationKey("join:plan-1", { name: "Crew", inviteToken: null })).not.toBe(key);
  });
});
