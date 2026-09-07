// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  DEVICE_ACCOUNT_OWNER_KEY,
  DEVICE_IDENTITY_CHANGED_EVENT,
  DEVICE_IDENTITY_LOCAL_KEYS,
  DEVICE_IDENTITY_SESSION_KEYS,
  subscribeDeviceIdentity,
} from "@/lib/deviceAccountIdentity";

describe("device identity storage notifications", () => {
  it("ignores another tab's composer draft writes and removals", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeDeviceIdentity(changed);
    try {
      for (const newValue of ['{"body":"A good night"}', null]) {
        window.dispatchEvent(new StorageEvent("storage", {
          key: "pubmaxx:social-composer:v1:alice:new", newValue,
        }));
      }
      window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "dark" }));
      expect(changed).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it.each([...DEVICE_IDENTITY_LOCAL_KEYS, ...DEVICE_IDENTITY_SESSION_KEYS, DEVICE_ACCOUNT_OWNER_KEY])(
    "notifies for an identity write or removal: %s", (key) => {
      const changed = vi.fn();
      const unsubscribe = subscribeDeviceIdentity(changed);
      try {
        window.dispatchEvent(new StorageEvent("storage", { key, newValue: "account-b" }));
        window.dispatchEvent(new StorageEvent("storage", { key, newValue: null }));
        expect(changed).toHaveBeenCalledTimes(2);
      } finally { unsubscribe(); }
    },
  );

  it("keeps clear and same-tab identity events, then removes both listeners", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeDeviceIdentity(changed);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    window.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: DEVICE_ACCOUNT_OWNER_KEY }));
    window.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
