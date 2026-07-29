import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetLastRideClientCache,
  loadLastRide,
  prefetchLastRide,
} from "@/lib/lastRideClient";

beforeEach(() => {
  __resetLastRideClientCache();
  vi.restoreAllMocks();
});

describe("last-ride client cache", () => {
  it("shares a sheet-open prefetch with the later card read", async () => {
    let resolveFetch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(() => pending);

    prefetchLastRide("london", 51.5, -0.12);
    const cardRead = loadLastRide("london", 51.5, -0.12);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    resolveFetch(
      new Response(JSON.stringify({ station: { name: "Westminster" }, trains: [] }), {
        status: 200,
      }),
    );
    await expect(cardRead).resolves.toEqual(
      expect.objectContaining({ station: { name: "Westminster" } }),
    );
  });

  it("drops a failed request so a later card read can retry", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ station: { name: "Temple" }, trains: [] }), {
          status: 200,
        }),
      );

    await expect(loadLastRide("london", 51.51, -0.11)).rejects.toThrow("offline");
    await expect(loadLastRide("london", 51.51, -0.11)).resolves.toEqual(
      expect.objectContaining({ station: { name: "Temple" } }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
