import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/night-signals/route";

describe("GET /api/night-signals", () => {
  it("returns the reviewed offline snapshot without a third-party request", async () => {
    const response = await GET(new Request("http://localhost/api/night-signals?entityId=venue-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, asOf: "2026-07-16T00:00:00.000Z", claims: [] });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
