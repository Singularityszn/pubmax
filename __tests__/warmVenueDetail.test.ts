import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetWarmVenueDetail,
  getWarmedVenue,
  warmVenueDetail,
} from "@/lib/warmVenueDetail";

afterEach(() => {
  __resetWarmVenueDetail();
  vi.unstubAllGlobals();
});

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

    expect(first).toEqual(venue);
    expect(second).toEqual(venue);
    expect(getWarmedVenue("venue-1")).toEqual(venue);
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
    expect(ra?.name).toBe("The Anchor");
    expect(rb?.name).toBe("The Anchor");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ venue: { id: "venue-3", name: "Retry Arms" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    expect(await warmVenueDetail("venue-3")).toBeNull();
    expect(await warmVenueDetail("venue-3")).toEqual({ id: "venue-3", name: "Retry Arms" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
