import { afterEach, beforeEach, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({ send: vi.fn(), pending: [] as Promise<unknown>[] }));
vi.mock("@/lib/venueIndex", () => ({ getVenueIndex: async () => new Map([["venue-1", { name: "Example Arms", lat: 51.539, lng: -0.143 }]]) }));
vi.mock("@/lib/pushSender", () => ({ fireAndForgetPush: (run: () => Promise<unknown>) => { push.pending.push(run()); }, sendPriceAlert: push.send }));

import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { runSecondReporterPass } from "@/lib/pintDropConfirm.server";
import { signalPriceAlert } from "@/lib/priceAlertLanded.server";
import { __resetPriceAlertStore, priceAlertStore } from "@/lib/priceAlertStore";
import type { PintDrop } from "@/lib/pintDropShared";

const NOW = Date.parse("2026-11-19T12:00:00Z");

function drop(id: string, authorityKey: string, minutesAfter: number): PintDrop {
  return { id, venueId: "venue-1", handle: id, drink: "lager", measure: "pint", priceGbp: 4.5, passedDownNote: "", era: "", provenance: "contributor", status: "visible", visibility: "public", authorityKey, createdAt: new Date(NOW + minutesAfter * 60_000).toISOString() };
}

async function settle(): Promise<void> {
  await Promise.all(push.pending.splice(0));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  __resetPintDrops();
  __resetPriceAlertStore();
  push.send.mockReset().mockResolvedValue({ sent: 1, results: [{ status: "sent" }] });
  await priceAlertStore().save("account-a", { area: "camden", thresholdPence: 500, token: "device" });
  vi.setSystemTime(NOW + 10 * 60_000);
});

afterEach(() => {
  vi.useRealTimers();
});

it("sends no area alert for a single unchecked Pint Drop", async () => {
  const lone = drop("drop-1", "key-one", 1);
  addPintDrop(lone);
  signalPriceAlert(lone);
  await settle();
  expect(push.send).not.toHaveBeenCalled();
});

it("sends one area alert when a second drinker confirms the price", async () => {
  addPintDrop(drop("drop-1", "key-one", 1));
  await runSecondReporterPass("venue-1", Date.now(), "key-one", "drop-1");
  await settle();
  expect(push.send).not.toHaveBeenCalled();

  addPintDrop(drop("drop-2", "key-two", 2));
  expect((await runSecondReporterPass("venue-1", Date.now(), "key-two", "drop-2")).status).toBe("confirmed");
  await settle();
  expect(push.send).toHaveBeenCalledTimes(1);
  expect(push.send.mock.calls[0]![1]).toMatchObject({ body: expect.stringContaining("£4.50 at Example Arms") });
});

it("alerts a subscriber who joined between reports and keeps the observation date", async () => {
  __resetPriceAlertStore();
  vi.setSystemTime(NOW - 3 * 24 * 60 * 60_000);
  addPintDrop(drop("drop-1", "key-one", -3 * 24 * 60));
  await runSecondReporterPass("venue-1", Date.now(), "key-one", "drop-1");
  await settle();

  vi.setSystemTime(NOW - 2 * 24 * 60 * 60_000);
  await priceAlertStore().save("account-a", { area: "camden", thresholdPence: 500, token: "device" });

  vi.setSystemTime(NOW - 24 * 60 * 60_000);
  addPintDrop(drop("drop-2", "key-two", -24 * 60));
  expect((await runSecondReporterPass("venue-1", Date.now(), "key-two", "drop-2")).status).toBe("confirmed");
  await settle();

  expect(push.send).toHaveBeenCalledTimes(1);
  expect(push.send.mock.calls[0]![1]).toMatchObject({
    body: "Two drinkers reported £4.50 at Example Arms, 16 Nov 2026.",
  });
});

it("does not deliver a pair hidden before dispatch, and drops a dead device token", async () => {
  addPintDrop(drop("drop-1", "key-one", 1));
  addPintDrop(drop("drop-2", "key-two", 2));
  await pintDropsStore().confirm(["drop-1", "drop-2"], { confirmationId: "pair", confirmedAt: new Date(NOW + 3 * 60_000).toISOString(), basis: "second_reporter", confirmingDropId: "drop-2" });
  const second = (await pintDropsStore().listConfirmationCandidates("venue-1")).find((item) => item.id === "drop-2");
  await pintDropsStore().moderate("drop-2", "hidden");
  signalPriceAlert(second!);
  await settle();
  expect(push.send).not.toHaveBeenCalled();

  await pintDropsStore().moderate("drop-2", "visible");
  push.send.mockResolvedValueOnce({ sent: 0, results: [{ status: "invalid" }] });
  signalPriceAlert(second!);
  await settle();
  expect(push.send).toHaveBeenCalledTimes(1);
  expect(await priceAlertStore().get("account-a")).toBeNull();
});
