import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/night-signals/route";

describe("GET /api/night-signals", () => {
  it("returns the reviewed offline snapshot without a third-party request", async () => {
    const response = await GET(new Request("http://localhost/api/night-signals?entityId=venue-1"));
    expect(response.status).toBe(200);
    // `durable` reports the moderator-reviewed rows the feed now reads beside
    // the snapshot; keyless, that read is the memory store and answers ready.
    expect(await response.json()).toEqual({
      version: 1,
      asOf: "2026-07-16T00:00:00.000Z",
      durable: "ready",
      claims: [],
    });
    // The response merges the shipped snapshot with approved rows from the
    // memory or durable store. Approvals and expiry can change between reads.
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
