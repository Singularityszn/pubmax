// The plan composer asks for "Your name" once per device, not every night.
//
// The name is public (the plan, the share card, the unfurler), so it is
// remembered the way the other things that speak for a person are: in
// DEVICE_IDENTITY_LOCAL_KEYS, cleared when the account on the device changes
// or signs out. An email address is never remembered (battle test L05).

import { describe, expect, it } from "vitest";

import {
  DEVICE_IDENTITY_LOCAL_KEYS,
  clearDeviceAccountArtifacts,
} from "@/lib/deviceAccountIdentity";
import {
  PLAN_HOST_NAME_KEY,
  readRememberedPlanHostName,
  rememberPlanHostName,
} from "@/lib/planHostName";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

const blocked = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
};

describe("the remembered host name", () => {
  it("reads back the name a plan was locked under", () => {
    const storage = memoryStorage();
    rememberPlanHostName(storage, "  Karan  ");
    expect(readRememberedPlanHostName(storage)).toBe("Karan");
  });

  it("holds nothing until a plan is locked", () => {
    expect(readRememberedPlanHostName(memoryStorage())).toBe("");
    expect(readRememberedPlanHostName(null)).toBe("");
  });

  it("never remembers an email address, and never replays one already held", () => {
    const storage = memoryStorage();
    rememberPlanHostName(storage, "alice@example.com");
    expect(storage.getItem(PLAN_HOST_NAME_KEY)).toBeNull();
    storage.setItem(PLAN_HOST_NAME_KEY, "alice@example.com");
    expect(readRememberedPlanHostName(storage)).toBe("");
  });

  it("asks again, rather than failing, when storage is blocked", () => {
    expect(() => rememberPlanHostName(blocked, "Karan")).not.toThrow();
    expect(readRememberedPlanHostName(blocked)).toBe("");
  });
});

describe("the remembered host name belongs to the person on the device", () => {
  it("is one of the keys that speak for an account", () => {
    expect(DEVICE_IDENTITY_LOCAL_KEYS).toContain(PLAN_HOST_NAME_KEY);
  });

  it("goes when the account changes or signs out", () => {
    const storage = memoryStorage();
    rememberPlanHostName(storage, "Karan");
    clearDeviceAccountArtifacts(storage);
    expect(readRememberedPlanHostName(storage)).toBe("");
  });
});
