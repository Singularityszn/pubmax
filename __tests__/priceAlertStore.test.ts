import { beforeEach, expect, it } from "vitest";

import { __resetPriceAlertStore, priceAlertStore } from "@/lib/priceAlertStore";

beforeEach(() => __resetPriceAlertStore());

it("keeps account preferences separate and claims each observation once", async () => {
  const store = priceAlertStore();
  await store.save("account-a", { area: "camden", thresholdPence: 500, token: "device-a" });
  await store.save("account-b", { area: "brixton", thresholdPence: 600, token: "device-b" });
  expect(await store.get("account-a")).toMatchObject({ area: "camden", thresholdPence: 500 });
  expect(await store.claim("account-a", "drop-1", { area: "camden", thresholdPence: 500, token: "device-a" })).toBe(true);
  expect(await store.claim("account-a", "drop-1", { area: "camden", thresholdPence: 500, token: "device-a" })).toBe(false);
  expect(await store.claim("account-b", "drop-1", { area: "brixton", thresholdPence: 600, token: "device-b" })).toBe(true);
  await store.remove("account-a");
  expect(await store.get("account-a")).toBeNull();
  expect(await store.get("account-b")).not.toBeNull();
  expect(await store.claim("account-a", "drop-2", { area: "camden", thresholdPence: 500, token: "device-a" })).toBe(false);
});

it("moves a device subscription when another account enables it", async () => {
  const store = priceAlertStore();
  await store.save("account-a", { area: "camden", thresholdPence: 500, token: "device-a" });
  await store.save("account-b", { area: "brixton", thresholdPence: 600, token: "device-a" });
  expect(await store.get("account-a")).toBeNull();
  expect(await store.get("account-b")).toMatchObject({ area: "brixton" });
  expect(await store.claim("account-a", "drop-1", { area: "camden", thresholdPence: 500, token: "device-a" })).toBe(false);
});

it("does not claim an event against an outdated threshold or area", async () => {
  const store = priceAlertStore();
  await store.save("account-a", { area: "brixton", thresholdPence: 400, token: "device-a" });
  expect(await store.claim("account-a", "drop-1", { area: "camden", thresholdPence: 500, token: "device-a" })).toBe(false);
});
