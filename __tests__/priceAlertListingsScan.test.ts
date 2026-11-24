import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as unknown[], version: "v1", reads: 0, delayFirstRead: false, recipients: true, recipientCount: 1, activated: 0, retries: [] as unknown[], send: vi.fn(), claim: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/lib/ukPriceBundle.server", () => ({ ukPriceBundleRowsByVenue: async () => { state.reads++; if (state.delayFirstRead) { state.delayFirstRead = false; vi.setSystemTime(new Date("2026-11-20T11:00:21Z")); } return { status: "ready", byVenue: new Map([["v", state.rows]]) }; } }));
vi.mock("@/lib/venueIndex", () => ({ getVenueIndexSnapshot: async () => ({ loadedCities: new Set(["london"]), index: new Map([["v", { id: "v", name: "Example Arms", borough: "Camden", lat: 51.539, lng: -0.143 }]]) }) }));
vi.mock("@/lib/priceAlertStore", () => ({ priceAlertStore: () => ({ listAll: async (after: string | null) => !state.recipients ? [] : Array.from({ length: state.recipientCount }, (_, i) => ({ userId: String.fromCharCode(97 + i), area: "camden", thresholdPence: 500, token: "t", enabled: true, enabledAt: "2026-11-20T12:00:00Z" })).filter((recipient) => !after || recipient.userId > after), claim: state.claim, settle: vi.fn(), activatePending: async () => state.activated, retryPage: async (after: string | null) => after ? [] : state.retries, dismissRetry: state.dismiss, backlog: async () => ({ retryable: 0, uncertain: 0, oldestPending: null }), removeIfToken: vi.fn() }) }));
vi.mock("@/lib/priceAlertSnapshotJob.server", async (original) => ({ ...(await original<typeof import("@/lib/priceAlertSnapshotJob.server")>()), priceAlertSnapshotVersion: () => state.version }));
vi.mock("@/lib/pushSender", () => ({ sendPriceAlert: state.send }));

import { scanListedPriceAlerts } from "@/lib/priceAlertListingsScan.server";
import { resetPriceAlertSnapshotForTests } from "@/lib/priceAlertSnapshotJob.server";
import { listedPriceAlertId } from "@/lib/priceAlertListings.server";

const row = { venueId: "v", name: "Example Arms", category: "beer", priceGbp: 4.5, lane: "site-harvest", standing: "listed", sourceUrl: "https://example.test/menu", publisher: "Example menu", observedAt: "2026-11-20T13:00:00Z", basis: null, sampleSize: null, servingSize: "Pint", drinkLabel: "Lager" } as const;

beforeEach(() => {
  state.rows = [row];
  state.version = "v1";
  state.reads = 0;
  state.delayFirstRead = false;
  state.recipients = true;
  state.recipientCount = 1;
  state.activated = 0;
  state.retries = [];
  state.dismiss.mockReset();
  state.claim.mockReset().mockResolvedValue(true);
  state.send.mockReset().mockResolvedValue({ targeted: 1, sent: 1, skipped: 0, pruned: 0, errors: 0, results: [{ token: "t", status: "sent" }] });
  resetPriceAlertSnapshotForTests();
});

it("drops a retry when the current snapshot no longer contains the listing", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-20T11:00:00Z"));
    await scanListedPriceAlerts();
    vi.setSystemTime(new Date("2026-11-20T14:00:00Z"));
    state.recipients = false;
    state.version = "v2";
    state.rows = [{ ...row, priceGbp: 4.25 }];
    const id = listedPriceAlertId(row);
    state.retries = [{ recipient: { userId: "a", area: "camden", thresholdPence: 500, token: "t", enabled: true, enabledAt: "2026-11-20T12:00:00Z" }, event: { id, venueId: "v", venueName: "Example Arms", pricePence: 450, lat: 51.539, lng: -0.143, observedAt: row.observedAt, sourceLabel: "Example menu", visibility: "public", status: "visible", measure: "pint" }, recordedAt: "2026-11-20T13:00:00Z" }];
    await scanListedPriceAlerts();
    expect(state.dismiss).toHaveBeenCalledWith("a", id);
    expect(state.send).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it("indexes the baseline once and sends a later snapshot's new listing", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-20T11:00:00Z"));
    expect((await scanListedPriceAlerts()).incomplete).toBe(false);
    vi.setSystemTime(new Date("2026-11-20T14:00:00Z"));
    expect((await scanListedPriceAlerts()).incomplete).toBe(false);
    expect(state.reads).toBe(1);
    expect(state.send).not.toHaveBeenCalled();
    state.version = "v2";
    state.rows = [row, { ...row, priceGbp: 4.25, observedAt: "2026-11-20T09:00:00Z" }];
    expect((await scanListedPriceAlerts()).incomplete).toBe(false);
    expect(state.send).toHaveBeenCalledOnce();
    expect(state.send.mock.calls[0]?.[1].body).toContain("£4.25");
    expect(state.claim).toHaveBeenCalledWith("a", expect.any(String), expect.any(Object), "2026-11-20T14:00:00.000Z", expect.any(String), expect.any(Object));
  } finally { vi.useRealTimers(); }
});

it("retains snapshot progress when the job budget expires", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-20T11:00:00Z"));
    state.delayFirstRead = true;
    expect((await scanListedPriceAlerts()).incomplete).toBe(true);
    expect(state.send).not.toHaveBeenCalled();
    expect((await scanListedPriceAlerts()).incomplete).toBe(false);
    expect(state.reads).toBe(2);
  } finally { vi.useRealTimers(); }
});

it("resumes after the last processed recipient without sending it twice", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-20T14:00:00Z"));
    state.send.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date("2026-11-20T14:00:21Z"));
      return { targeted: 1, sent: 1, skipped: 0, pruned: 0, errors: 0, results: [{ token: "t", status: "sent" }] };
    });
    expect((await scanListedPriceAlerts()).incomplete).toBe(true);
    expect(state.send).toHaveBeenCalledOnce();
    expect((await scanListedPriceAlerts()).incomplete).toBe(false);
    expect(state.send).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it("retains an unfinished recipient when its claim fails", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-20T14:00:00Z"));
    state.claim.mockRejectedValueOnce(new Error("claim unavailable"));
    await expect(scanListedPriceAlerts()).rejects.toThrow("claim unavailable");
    expect(state.send).not.toHaveBeenCalled();
    expect((await scanListedPriceAlerts()).incomplete).toBe(false);
    expect(state.send).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it("retains the retry cursor when its claim fails", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-20T14:00:00Z"));
    state.recipients = false;
    state.retries = [{ recipient: { userId: "a", area: "camden", thresholdPence: 500, token: "t", enabled: true, enabledAt: "2026-11-20T12:00:00Z" }, event: { id: listedPriceAlertId(row), venueId: "v", venueName: "Example Arms", pricePence: 450, lat: 51.539, lng: -0.143, observedAt: row.observedAt, sourceLabel: "Example menu", visibility: "public", status: "visible", measure: "pint" }, recordedAt: "2026-11-20T13:00:00Z" }];
    state.claim.mockRejectedValueOnce(new Error("retry claim unavailable"));
    await expect(scanListedPriceAlerts()).rejects.toThrow("retry claim unavailable");
    expect((await scanListedPriceAlerts()).incomplete).toBe(false);
    expect(state.send).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it("checkpoints within a slow recipient batch and resumes the remainder", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-20T14:00:00Z"));
    state.recipientCount = 25;
    state.send.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 1_500);
      return { targeted: 1, sent: 1, skipped: 0, pruned: 0, errors: 0, results: [{ token: "t", status: "sent" }] };
    });
    expect((await scanListedPriceAlerts()).incomplete).toBe(true);
    expect(state.send).toHaveBeenCalledTimes(14);
    expect((await scanListedPriceAlerts()).incomplete).toBe(false);
    expect(state.send).toHaveBeenCalledTimes(25);
    expect(new Set(state.claim.mock.calls.map(([userId]) => userId)).size).toBe(25);
  } finally { vi.useRealTimers(); }
});

it("continues delivery after activating a full batch", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-20T14:00:00Z"));
    state.activated = 25;
    expect((await scanListedPriceAlerts()).incomplete).toBe(true);
    expect(state.send).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it("retains the recipient when refused candidates exhaust the deadline", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-20T14:00:00Z"));
    state.rows = Array.from({ length: 250 }, (_, i) => ({ ...row, drinkLabel: `Lager ${i}` }));
    let firstRun = true;
    state.claim.mockImplementation(async () => {
      if (!firstRun) return true;
      vi.setSystemTime(Date.now() + 150);
      return false;
    });
    expect((await scanListedPriceAlerts()).incomplete).toBe(true);
    expect(state.claim.mock.calls.length).toBeLessThan(250);
    expect(state.send).not.toHaveBeenCalled();
    firstRun = false;
    expect((await scanListedPriceAlerts()).incomplete).toBe(false);
    expect(state.send).toHaveBeenCalledOnce();
    expect(state.claim.mock.calls.at(-1)?.[0]).toBe("a");
  } finally { vi.useRealTimers(); }
});

it("uses the request start when reconciliation consumes the scan budget", async () => {
  vi.useFakeTimers();
  try {
    const start = Date.parse("2026-11-20T14:00:00Z");
    vi.setSystemTime(start + 20_000);
    expect((await scanListedPriceAlerts(start)).incomplete).toBe(true);
    expect(state.reads).toBe(0);
    expect(state.send).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
