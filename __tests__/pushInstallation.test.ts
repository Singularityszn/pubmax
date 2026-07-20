import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptPushIdentityMutationVersion,
  __resetPushInstallation,
  MAX_PUSH_MUTATION_VERSION,
  nextPushIdentityMutation,
  PUSH_MUTATION_VERSION_KEY,
  pushInstallationId,
  validatePushIdentityMutation,
} from "@/lib/pushInstallation";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

beforeEach(() => {
  __resetPushInstallation();
  vi.stubGlobal("window", { localStorage: storage() });
});

afterEach(() => vi.unstubAllGlobals());

describe("push installation epoch", () => {
  it("persists independently of notification permission and survives module reset", () => {
    const first = pushInstallationId();
    __resetPushInstallation();
    expect(pushInstallationId()).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("issues monotonically increasing client-intent versions", () => {
    const first = nextPushIdentityMutation();
    const second = nextPushIdentityMutation();
    expect(second.installationId).toBe(first.installationId);
    expect(second.mutationVersion).toBe(first.mutationVersion + 1);
  });

  it("persists a returned server watermark before issuing the next intent", () => {
    expect(nextPushIdentityMutation().mutationVersion).toBe(1);
    expect(acceptPushIdentityMutationVersion(40)).toBe(true);
    __resetPushInstallation();
    expect(nextPushIdentityMutation().mutationVersion).toBe(41);
  });

  it("never overwrites a higher durable watermark from another browser context", () => {
    nextPushIdentityMutation();
    window.localStorage.setItem(PUSH_MUTATION_VERSION_KEY, "50");
    expect(acceptPushIdentityMutationVersion(40)).toBe(true);
    expect(nextPushIdentityMutation().mutationVersion).toBe(51);
  });

  it("rejects invalid and overflowing server watermarks", () => {
    pushInstallationId();
    expect(acceptPushIdentityMutationVersion(0)).toBe(false);
    expect(acceptPushIdentityMutationVersion(MAX_PUSH_MUTATION_VERSION + 1)).toBe(false);
  });

  it("rejects forged installation epochs and non-integer versions", () => {
    expect(validatePushIdentityMutation({ installationId: "chosen", mutationVersion: 1 }).ok).toBe(false);
    expect(validatePushIdentityMutation({
      installationId: "00000000-0000-4000-8000-000000000047",
      mutationVersion: 1.5,
    }).ok).toBe(false);
  });

  it("refuses identity mutations when the installation epoch cannot persist", () => {
    __resetPushInstallation();
    vi.stubGlobal("window", {});
    expect(() => nextPushIdentityMutation()).toThrow(/persistence/);
  });
});
