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
    // Keyless, the answer is still derived purely from the shipped snapshot (a
    // refresh is a redeploy, which purges the edge) — CDN-cacheable, not
    // no-store. With a durable store the body carries rows a moderator can
    // change, and `nightSignalFeedApproved.test.ts` holds it to no-store there.
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(response.headers.get("cache-control")).toContain("stale-while-revalidate");
  });
});
