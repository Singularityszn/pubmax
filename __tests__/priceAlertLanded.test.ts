import { expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ visible: vi.fn(), list: vi.fn(), claim: vi.fn(), send: vi.fn(), pending: [] as Promise<unknown>[] }));
vi.mock("@/lib/pintDropsStore", () => ({ pintDropsStore: () => ({ listVisible: boundary.visible }) }));
vi.mock("@/lib/venueIndex", () => ({ getVenueIndex: async () => new Map([["venue-1", { name: "Example Arms", lat: 51.539, lng: -0.143 }]]) }));
vi.mock("@/lib/priceAlertStore", () => ({ priceAlertStore: () => ({ list: boundary.list, claim: boundary.claim }) }));
vi.mock("@/lib/pushSender", () => ({ fireAndForgetPush: (run: () => Promise<unknown>) => { boundary.pending.push(run()); }, sendPriceAlert: boundary.send }));

import { signalPriceAlert } from "@/lib/priceAlertLanded.server";
import type { PintDrop } from "@/lib/pintDropShared";

it("delivers a visible new pint and does not deliver a report hidden before dispatch", async () => {
  const drop: PintDrop = { id: "drop-1", venueId: "venue-1", handle: "test", drink: "lager", measure: "pint", priceGbp: 4.5, passedDownNote: "", era: "", provenance: "contributor", status: "visible", visibility: "public", createdAt: "2026-11-19T12:00:00Z" };
  boundary.visible.mockResolvedValueOnce([drop]).mockResolvedValueOnce([]);
  boundary.list.mockResolvedValue([{ userId: "account-a", area: "camden", thresholdPence: 500, token: "device", enabled: true }]);
  boundary.claim.mockResolvedValue(true);
  boundary.send.mockResolvedValue({ sent: 1 });
  signalPriceAlert(drop);
  await Promise.all(boundary.pending.splice(0));
  expect(boundary.send).toHaveBeenCalledTimes(1);
  signalPriceAlert(drop);
  await Promise.all(boundary.pending.splice(0));
  expect(boundary.send).toHaveBeenCalledTimes(1);
});
