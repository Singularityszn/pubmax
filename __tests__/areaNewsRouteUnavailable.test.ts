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
    expect(body).toEqual({ status: "unavailable", entries: [], award: null });
  });
});
