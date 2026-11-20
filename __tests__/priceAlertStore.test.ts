import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { __resetPriceAlertStore, priceAlertStore } from "@/lib/priceAlertStore";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-20T12:00:00Z")); __resetPriceAlertStore(); });
afterEach(() => vi.useRealTimers());

it.each([1, 475, 601, 100000])("rejects a non-preset threshold without replacing a preference: %i", async (thresholdPence) => {
  const store = priceAlertStore();
  const setting = { area: "camden", thresholdPence: 500, token: "device-a" };
  await store.save("account-a", setting);
  await expect(store.save("account-a", { ...setting, thresholdPence })).rejects.toThrow();
  expect(await store.get("account-a")).toMatchObject(setting);
});

it("keeps account preferences separate and claims each observation once", async () => {
  const store = priceAlertStore();
  await store.save("account-a", { area: "camden", thresholdPence: 500, token: "device-a" });
  await store.save("account-b", { area: "brixton", thresholdPence: 600, token: "device-b" });
  vi.setSystemTime(new Date("2026-11-20T13:00:00Z"));
  expect(await store.get("account-a")).toMatchObject({ area: "camden", thresholdPence: 500 });
  expect(await store.claim("account-a", "drop-1", { area: "camden", thresholdPence: 500, token: "device-a" }, "2026-11-20T12:30:00Z")).toBe(true);
  expect(await store.claim("account-a", "drop-1", { area: "camden", thresholdPence: 500, token: "device-a" }, "2026-11-20T12:30:00Z")).toBe(false);
  expect(await store.claim("account-b", "drop-1", { area: "brixton", thresholdPence: 600, token: "device-b" }, "2026-11-20T12:30:00Z")).toBe(true);
  await store.remove("account-a");
  expect(await store.get("account-a")).toBeNull();
  expect(await store.get("account-b")).not.toBeNull();
  expect(await store.claim("account-a", "drop-2", { area: "camden", thresholdPence: 500, token: "device-a" }, "2026-11-20T12:30:00Z")).toBe(false);
});

it("moves a device subscription when another account enables it", async () => {
  const store = priceAlertStore();
  await store.save("account-a", { area: "camden", thresholdPence: 500, token: "device-a" });
  await store.save("account-b", { area: "brixton", thresholdPence: 600, token: "device-a" });
  expect(await store.get("account-a")).toBeNull();
  expect(await store.get("account-b")).toMatchObject({ area: "brixton" });
  expect(await store.claim("account-a", "drop-1", { area: "camden", thresholdPence: 500, token: "device-a" }, "2026-11-20T12:30:00Z")).toBe(false);
});

it("does not claim an event against an outdated threshold or area", async () => {
  const store = priceAlertStore();
  await store.save("account-a", { area: "brixton", thresholdPence: 400, token: "device-a" });
  expect(await store.claim("account-a", "drop-1", { area: "camden", thresholdPence: 500, token: "device-a" }, "2026-11-20T12:30:00Z")).toBe(false);
});

it("removes an invalid device only if it is still the registered device", async () => {
  const store = priceAlertStore();
  await store.save("account-a", { area: "camden", thresholdPence: 500, token: "old" });
  await store.save("account-a", { area: "camden", thresholdPence: 500, token: "new" });
  await store.removeIfToken("account-a", "old");
  expect(await store.get("account-a")).not.toBeNull();
  await store.removeIfToken("account-a", "new");
  expect(await store.get("account-a")).toBeNull();
});

it("rejects old observations and limits each area to one delivery per London day", async () => {
  const store = priceAlertStore();
  const setting = { area: "camden", thresholdPence: 500, token: "device-a" };
  await store.save("account-a", setting);
  vi.setSystemTime(new Date("2026-11-20T14:00:00Z"));
  expect(await store.claim("account-a", "listed:old", setting, "2026-11-20T11:00:00Z")).toBe(false);
  expect(await store.claim("account-a", "listed:new", setting, "2026-11-20T13:00:00Z")).toBe(true);
  expect(await store.listAll()).toEqual([]);
  expect(await store.claim("account-a", "drop:new", setting, "2026-11-20T13:30:00Z")).toBe(false);
  vi.setSystemTime(new Date("2026-11-21T14:00:00Z"));
  expect(await store.listAll()).toHaveLength(1);
  expect(await store.claim("account-a", "listed:new", setting, "2026-11-20T13:00:00Z")).toBe(false);
  expect(await store.claim("account-a", "drop:tomorrow", setting, "2026-11-21T13:00:00Z")).toBe(true);
});
