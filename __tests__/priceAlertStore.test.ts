import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { __resetPriceAlertStore, priceAlertStore } from "@/lib/priceAlertStore";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-20T12:00:00Z")); __resetPriceAlertStore(); });
afterEach(() => vi.useRealTimers());

it("keeps a new preference pending until a snapshot is indexed", async () => {
  const store = priceAlertStore();
  const setting = { area: "camden", thresholdPence: 500, token: "device-a" };
  await store.save("account-a", setting, "2026-11-20T13:00:00Z");
  expect(await store.get("account-a")).toMatchObject({ status: "pending" });
  expect(await store.listAll()).toEqual([]);
  vi.setSystemTime(new Date("2026-11-20T13:00:00Z"));
  expect(await store.activatePending("2026-11-20T12:00:00Z", "test", 25)).toBe(0);
  await store.activatePending("2026-11-20T13:00:00Z", "test", 25);
  expect(await store.get("account-a")).toMatchObject({ status: "active" });
  expect(await store.claim("account-a", "listed:baseline", setting, "2026-11-20T12:30:00Z")).toBe(false);
});

it.each([1, 400, 450, 475, 550, 600, 601, 100000])("rejects a threshold other than 500 pence without replacing a preference: %i", async (thresholdPence) => {
  const store = priceAlertStore();
  const setting = { area: "camden", thresholdPence: 500, token: "device-a" };
  await store.save("account-a", setting);
  await store.activatePending("test", "test", 100);
  await expect(store.save("account-a", { ...setting, thresholdPence })).rejects.toThrow();
  expect(await store.get("account-a")).toMatchObject(setting);
});

it("keeps account preferences separate and claims each observation once", async () => {
  const store = priceAlertStore();
  await store.save("account-a", { area: "camden", thresholdPence: 500, token: "device-a" });
  await store.activatePending("test", "test", 100);
  await store.save("account-b", { area: "brixton", thresholdPence: 500, token: "device-b" });
  await store.activatePending("test", "test", 100);
  vi.setSystemTime(new Date("2026-11-20T13:00:00Z"));
  expect(await store.get("account-a")).toMatchObject({ area: "camden", thresholdPence: 500 });
  expect(await store.claim("account-a", "drop-1", { area: "camden", thresholdPence: 500, token: "device-a" }, "2026-11-20T12:30:00Z")).toBe(true);
  expect(await store.claim("account-a", "drop-1", { area: "camden", thresholdPence: 500, token: "device-a" }, "2026-11-20T12:30:00Z")).toBe(false);
  expect(await store.claim("account-b", "drop-1", { area: "brixton", thresholdPence: 500, token: "device-b" }, "2026-11-20T12:30:00Z")).toBe(true);
  await store.remove("account-a");
  expect(await store.get("account-a")).toBeNull();
  expect(await store.get("account-b")).not.toBeNull();
  expect(await store.claim("account-a", "drop-2", { area: "camden", thresholdPence: 500, token: "device-a" }, "2026-11-20T12:30:00Z")).toBe(false);
});

it("moves a device subscription when another account enables it", async () => {
  const store = priceAlertStore();
  await store.save("account-a", { area: "camden", thresholdPence: 500, token: "device-a" });
  await store.activatePending("test", "test", 100);
  await store.save("account-b", { area: "brixton", thresholdPence: 500, token: "device-a" });
  await store.activatePending("test", "test", 100);
  expect(await store.get("account-a")).toBeNull();
  expect(await store.get("account-b")).toMatchObject({ area: "brixton" });
  expect(await store.claim("account-a", "drop-1", { area: "camden", thresholdPence: 500, token: "device-a" }, "2026-11-20T12:30:00Z")).toBe(false);
});

it("does not claim an event against an outdated area", async () => {
  const store = priceAlertStore();
  await store.save("account-a", { area: "brixton", thresholdPence: 500, token: "device-a" });
  await store.activatePending("test", "test", 100);
  expect(await store.claim("account-a", "drop-1", { area: "camden", thresholdPence: 500, token: "device-a" }, "2026-11-20T12:30:00Z")).toBe(false);
});

it("removes an invalid device only if it is still the registered device", async () => {
  const store = priceAlertStore();
  await store.save("account-a", { area: "camden", thresholdPence: 500, token: "old" });
  await store.activatePending("test", "test", 100);
  await store.save("account-a", { area: "camden", thresholdPence: 500, token: "new" });
  await store.activatePending("test", "test", 100);
  await store.removeIfToken("account-a", "old");
  expect(await store.get("account-a")).not.toBeNull();
  await store.removeIfToken("account-a", "new");
  expect(await store.get("account-a")).toBeNull();
});

it("rejects old observations and limits each area to one delivery per London day", async () => {
  const store = priceAlertStore();
  const setting = { area: "camden", thresholdPence: 500, token: "device-a" };
  await store.save("account-a", setting);
  await store.activatePending("test", "test", 100);
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

it("retries a failed delivery for the same event without admitting another event", async () => {
  const store = priceAlertStore();
  const setting = { area: "camden", thresholdPence: 500, token: "device-a" };
  await store.save("account-a", setting);
  await store.activatePending("test", "test", 100);
  vi.setSystemTime(new Date("2026-11-20T14:00:00Z"));
  expect(await store.claim("account-a", "listed:new", setting, "2026-11-20T13:00:00Z", "attempt-one")).toBe(true);
  await store.settle("account-a", "listed:new", "attempt-one", "retryable");
  expect(await store.listAll()).toEqual([]);
  expect(await store.claim("account-a", "drop:other", setting, "2026-11-20T13:30:00Z")).toBe(false);
  expect(await store.claim("account-a", "listed:new", setting, "2026-11-20T13:00:00Z", "attempt-two")).toBe(true);
  await store.settle("account-a", "listed:new", "attempt-two", "delivered");
  expect(await store.claim("account-a", "listed:new", setting, "2026-11-20T13:00:00Z")).toBe(false);
});

it.each(["listed:new", "pint-drop-confirmation:pair"])("keeps the event needed for a retry: %s", async (id) => {
  const store = priceAlertStore();
  const setting = { area: "camden", thresholdPence: 500, token: "device-a" };
  const event = { id, venueId: "v", venueName: "A pub", pricePence: 450, lat: 51.539, lng: -0.143, observedAt: "2026-11-20T12:30:00Z", sourceLabel: "Menu", visibility: "public", status: "visible", measure: "pint" };
  await store.save("account-a", setting);
  await store.activatePending("test", "test", 25);
  vi.setSystemTime(new Date("2026-11-20T14:00:00Z"));
  expect(await store.claim("account-a", event.id, setting, "2026-11-20T13:00:00Z", "one", event)).toBe(true);
  await store.settle("account-a", event.id, "one", "retryable");
  expect(await store.listAll()).toEqual([]);
  expect(await store.retryPage(null, null, 25)).toMatchObject([{ event, recordedAt: "2026-11-20T13:00:00Z" }]);
});
