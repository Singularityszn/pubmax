import { afterEach, describe, expect, it, vi } from "vitest";

import { saveVenueDetail } from "@/lib/savedVenueDetails";
import {
  __resetWarmVenueDetail,
  getWarmedVenue,
  rememberOpenedVenue,
  savedVenueCopyAt,
  warmVenueDetail,
} from "@/lib/warmVenueDetail";

afterEach(() => {
  __resetWarmVenueDetail();
  vi.unstubAllGlobals();
});

/**
 * The wire carries `amenityStatus` and no amenity booleans, so every result is
 * the payload PLUS the record this tree rebuilds from that status. The stub
 * payloads below state nothing, so every answer is unknown and every boolean is
 * false, which is the "not known to be true" every filter already reads.
 */
const UNKNOWN_AMENITIES = {
  amenityStatus: {
    food: "unknown",
    cocktails: "unknown",
    beerGarden: "unknown",
    liveSports: "unknown",
    liveMusic: "unknown",
    pubQuiz: "unknown",
    darts: "unknown",
    pool: "unknown",
    happyHour: "unknown",
    karaoke: "unknown",
    nonAlcoholic: "unknown",
  },
  amenities: {
    food: false,
    cocktails: false,
    beerGarden: false,
    liveSports: false,
    liveMusic: false,
    pubQuiz: false,
    darts: false,
    pool: false,
    happyHour: false,
    karaoke: false,
    nonAlcoholic: false,
  },
};

describe("warmVenueDetail", () => {
  it("caches a successful venue detail for the session", async () => {
    const venue = { id: "venue-1", name: "The Crown" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ venue }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await warmVenueDetail("venue-1");
    const second = await warmVenueDetail("venue-1");

    const rebuilt = { ...venue, ...UNKNOWN_AMENITIES };
    expect(first).toEqual({ status: "found", venue: rebuilt });
    expect(second).toEqual({ status: "found", venue: rebuilt });
    expect(getWarmedVenue("venue-1")).toEqual(rebuilt);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("joins in-flight requests for the same id", async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const a = warmVenueDetail("venue-2");
    const b = warmVenueDetail("venue-2");
    resolveFetch({
      ok: true,
      json: async () => ({ venue: { id: "venue-2", name: "The Anchor" } }),
    });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual({
      status: "found",
      venue: { id: "venue-2", name: "The Anchor", ...UNKNOWN_AMENITIES },
    });
    expect(rb).toEqual({
      status: "found",
      venue: { id: "venue-2", name: "The Anchor", ...UNKNOWN_AMENITIES },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a confirmed missing venue from a failed lookup", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ venue: { id: "venue-3", name: "Retry Arms" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    expect(await warmVenueDetail("venue-3")).toEqual({ status: "missing" });
    expect(await warmVenueDetail("venue-3")).toEqual({ status: "failed" });
    expect(await warmVenueDetail("venue-3")).toEqual({
      status: "found",
      venue: { id: "venue-3", name: "Retry Arms", ...UNKNOWN_AMENITIES },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("accepts a canonical venue returned for an aliased id", async () => {
    const venue = { id: "venue-canonical", name: "The Canonical Arms" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ venue }),
    }));

    const rebuilt = { ...venue, ...UNKNOWN_AMENITIES };
    expect(await warmVenueDetail("venue-alias")).toEqual({ status: "found", venue: rebuilt });
    expect(getWarmedVenue("venue-alias")).toEqual(rebuilt);
    expect(getWarmedVenue("venue-canonical")).toEqual(rebuilt);
  });

  it("reopens a pub the reader opened before from its dated device copy when the network is gone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T20:15:00.000Z"));
    vi.stubGlobal("localStorage", memoryStorage());
    const venue = {
      id: "venue-saved",
      name: "The Saved Arms",
      prices: [{ price_gbp: 5.2, source: "Menu", observed_at: "2026-11-01" }],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ venue }) });
    vi.stubGlobal("fetch", fetchMock);
    await warmVenueDetail("venue-saved");
    rememberOpenedVenue("venue-saved");
    vi.useRealTimers();

    // A fresh session with no signal.
    __resetWarmVenueDetail();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const savedResult = await warmVenueDetail("venue-saved");
    expect(savedResult).toEqual({
      status: "found",
      venue: { ...venue, ...UNKNOWN_AMENITIES },
      savedAt: "2026-11-10T20:15:00.000Z",
    });
    if (savedResult.status !== "found") throw new Error("Expected the saved venue");
    expect(savedVenueCopyAt(savedResult.venue)).toBe("2026-11-10T20:15:00.000Z");
    // The copy is never a session hit, so the next open asks the network again.
    expect(getWarmedVenue("venue-saved")).toBeNull();

    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ venue }) });
    const liveResult = await warmVenueDetail("venue-saved");
    expect(liveResult).toEqual({
      status: "found",
      venue: { ...venue, ...UNKNOWN_AMENITIES },
    });
    if (liveResult.status !== "found") throw new Error("Expected the live venue");
    expect(savedVenueCopyAt(liveResult.venue)).toBeNull();
    expect(savedVenueCopyAt(savedResult.venue)).toBe("2026-11-10T20:15:00.000Z");
  });

  it("answers only a failed lookup offline for a pub the reader never opened, or a server error", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const venue = { id: "venue-opened", name: "The Opened", prices: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ venue }) });
    vi.stubGlobal("fetch", fetchMock);
    await warmVenueDetail("venue-opened");
    rememberOpenedVenue("venue-opened");
    __resetWarmVenueDetail();

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await warmVenueDetail("venue-never-opened")).toEqual({ status: "failed" });
    // A server that answers is not a lost signal, so it never reads as offline.
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    expect(await warmVenueDetail("venue-opened")).toEqual({ status: "failed" });
  });

  it("reopens both the requested alias and canonical pub offline", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const venue = { id: "venue-canonical", name: "The Alias Arms", prices: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ venue }) });
    vi.stubGlobal("fetch", fetchMock);
    await warmVenueDetail("venue-alias");
    rememberOpenedVenue("venue-alias");
    rememberOpenedVenue("venue-canonical");
    __resetWarmVenueDetail();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    for (const id of ["venue-alias", "venue-canonical"]) {
      expect(await warmVenueDetail(id)).toMatchObject({
        status: "found",
        venue: { id: "venue-canonical", name: "The Alias Arms" },
        savedAt: expect.any(String),
      });
    }
  });

  it("uses a saved copy after a body read fails but preserves HTTP errors", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const venue = { id: "venue-body", name: "The Body Arms", prices: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ venue }) });
    vi.stubGlobal("fetch", fetchMock);
    await warmVenueDetail("venue-body");
    rememberOpenedVenue("venue-body");
    __resetWarmVenueDetail();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new TypeError("Connection lost during body read"); },
    });
    expect(await warmVenueDetail("venue-body")).toMatchObject({
      status: "found",
      venue: { id: "venue-body", name: "The Body Arms" },
      savedAt: expect.any(String),
    });
    expect(getWarmedVenue("venue-body")).toBeNull();
    expect(await warmVenueDetail("venue-never-opened")).toEqual({ status: "failed" });
    for (const [status, expected] of [[404, "missing"], [503, "failed"]] as const) {
      fetchMock.mockResolvedValue({ ok: false, status });
      expect(await warmVenueDetail("venue-body")).toEqual({ status: expected });
    }
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ venue }) });
    expect(await warmVenueDetail("venue-body")).toMatchObject({ status: "found", venue });
  });

  it.each(["fetch", "body"] as const)("refreshes a saved result when reconnection precedes %s rejection", async (failure) => {
    vi.stubGlobal("localStorage", memoryStorage());
    const connection = { onLine: false };
    vi.stubGlobal("navigator", connection);
    const saved = { id: "venue-canonical", name: "Saved Arms", prices: [] };
    const live = { ...saved, name: "Live Arms" };
    saveVenueDetail("venue-alias", saved, new Date("2026-11-10T20:00:00.000Z"));
    let rejectInterrupted!: (reason: Error) => void;
    const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject; });
    let startBodyRead!: () => void;
    const bodyReadStarted = new Promise<void>((resolve) => { startBodyRead = resolve; });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => failure === "fetch" ? interrupted : Promise.resolve({
        ok: true,
        json: () => {
          startBodyRead();
          return interrupted;
        },
      }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ venue: live }) });
    vi.stubGlobal("fetch", fetchMock);

    const selected = warmVenueDetail("venue-alias");
    const hydration = warmVenueDetail("venue-alias");
    if (failure === "body") await bodyReadStarted;
    connection.onLine = true;
    rejectInterrupted(new TypeError("Connection lost"));

    for (const result of await Promise.all([selected, hydration])) {
      expect(result).toEqual({ status: "found", venue: { ...live, ...UNKNOWN_AMENITIES } });
    }
    expect(getWarmedVenue("venue-alias")).toEqual({ ...live, ...UNKNOWN_AMENITIES });
    expect(getWarmedVenue("venue-canonical")).toEqual({ ...live, ...UNKNOWN_AMENITIES });
    expect(savedVenueCopyAt(getWarmedVenue("venue-alias")!)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["fetch", "body", "missing", "server"] as const)("keeps the dated copy when the single online retry fails at %s", async (failure) => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("navigator", { onLine: true });
    const venue = { id: "venue-saved", name: "Saved Arms", prices: [] };
    const savedAt = "2026-11-10T20:00:00.000Z";
    saveVenueDetail(venue.id, venue, new Date(savedAt));
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Connection lost"));
    if (failure === "fetch") {
      fetchMock.mockRejectedValue(new TypeError("Still unavailable"));
    } else if (failure === "body") {
      fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new TypeError("Body interrupted"); } });
    } else {
      fetchMock.mockResolvedValue({ ok: false, status: failure === "missing" ? 404 : 503 });
    }
    vi.stubGlobal("fetch", fetchMock);

    const result = await warmVenueDetail(venue.id);
    expect(result).toEqual({ status: "found", venue: { ...venue, ...UNKNOWN_AMENITIES }, savedAt });
    if (result.status !== "found") throw new Error("Expected saved detail");
    expect(savedVenueCopyAt(result.venue)).toBe(savedAt);
    expect(getWarmedVenue(venue.id)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
