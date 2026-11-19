import { describe, expect, it, vi } from "vitest";

const loadAreaNews = vi.hoisted(() => vi.fn());

vi.mock("@/lib/areaNews.server", () => ({ loadAreaNews }));

import { GET } from "@/app/api/area-news/route";

describe("GET /api/area-news unavailable response", () => {
  it("preserves an unavailable dataset without returning successful-empty data", async () => {
    loadAreaNews.mockResolvedValue({ status: "unavailable", entries: [] });

    const response = await GET(new Request("https://x/api/area-news?area=soho"));
    const body = (await response.json()) as { status: string; entries: unknown[] };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({ status: "unavailable", entries: [], award: null });
  });

  it("rejects an unknown area filter before reading the dataset", async () => {
    loadAreaNews.mockClear();

    const response = await GET(new Request("https://x/api/area-news?area=not-an-area"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Unknown area.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
    expect(loadAreaNews).not.toHaveBeenCalled();
  });

  it.each([
    ["2026-11-19T12:00:00Z", 60],
    ["2026-11-19T23:59:50.200Z", 9],
  ])("bounds the browser cache by the freshness cutoff at %s", async (now, maxAge) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    try {
      loadAreaNews.mockResolvedValue({
        status: "ready",
        version: 1,
        generatedAt: "2026-08-28T00:00:00.000Z",
        entries: [],
      });

      const areaResponse = await GET(new Request("https://x/api/area-news?area=soho"));
      const venueResponse = await GET(new Request("https://x/api/area-news?venueId=venue-nope"));

      const cacheControl = `private, max-age=${maxAge}, must-revalidate`;
      expect(areaResponse.headers.get("Cache-Control")).toBe(cacheControl);
      expect(venueResponse.headers.get("Cache-Control")).toBe(cacheControl);
      expect(await areaResponse.json()).toEqual({ status: "ready", entries: [] });
      expect(await venueResponse.json()).toEqual({ status: "ready", award: null });
    } finally {
      vi.useRealTimers();
    }
  });
});
