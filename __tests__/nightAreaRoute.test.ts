import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/night-areas/[slug]/route";

describe("GET /api/night-areas/:slug", () => {
  it("returns a pilot Night Area with daypart guidance and provenance-ready signals", async () => {
    const response = await GET(new Request("http://localhost/api/night-areas/clapham"), {
      params: Promise.resolve({ slug: "clapham" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      slug: "clapham",
      name: "Clapham",
      transportAnchors: expect.any(Array),
      daypartGuidance: { after_work: expect.any(String), late_night: expect.any(String) },
      recentSignals: [],
    });
  });

  it("rejects areas outside the six pilots", async () => {
    const response = await GET(new Request("http://localhost/api/night-areas/camden"), {
      params: Promise.resolve({ slug: "camden" }),
    });
    expect(response.status).toBe(404);
  });
});
