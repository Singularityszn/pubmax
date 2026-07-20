import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetPushInstallation,
  nextPushIdentityMutation,
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
