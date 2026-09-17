// B2 (Astra live walk, 7 Sep 2026): GET /api/area-news answered 400 "Unknown
// area." for five of London's twenty patches, because the map passes the Night
// Area slug ("piccadilly-soho") while the dataset files its facts under the
// neighbourhood ("soho"). The other fifteen passed by coincidence.
//
// The sweep below is the fence: every Night Area slug answers 200, and a slug
// the join table cannot reach answers "unavailable" rather than an empty list,
// because no fact can ever be filed under it.

import { describe, expect, it, vi } from "vitest";

import { LONDON_NIGHT_AREA_SLUGS, NIGHT_AREA_SLUGS } from "@/lib/nightAreas";
import { areaNewsLaneCovers, isKnownAreaSlug } from "@/lib/areaNews";

const loadAreaNews = vi.hoisted(() => vi.fn());

vi.mock("@/lib/areaNews.server", () => ({ loadAreaNews }));

import { GET } from "@/app/api/area-news/route";

function readArea(area: string): Promise<Response> {
  return GET(new Request(`https://x/api/area-news?area=${encodeURIComponent(area)}`));
}

describe("area news accepts every Night Area slug", () => {
  it("knows every Night Area slug the map can be sitting on", () => {
    for (const slug of NIGHT_AREA_SLUGS) {
      expect(isKnownAreaSlug(slug), slug).toBe(true);
    }
  });

  it("answers 200 for all twenty London patches", async () => {
    loadAreaNews.mockResolvedValue({
      status: "ready",
      version: 1,
      generatedAt: "2026-09-01T00:00:00.000Z",
      entries: [],
    });

    const statuses = await Promise.all(
      LONDON_NIGHT_AREA_SLUGS.map(async (slug) => [slug, (await readArea(slug)).status] as const),
    );

    expect(statuses.filter(([, status]) => status !== 200)).toEqual([]);
  });

  it("answers the five patches that used to 400", async () => {
    loadAreaNews.mockResolvedValue({
      status: "ready",
      version: 1,
      generatedAt: "2026-09-01T00:00:00.000Z",
      entries: [],
    });

    for (const slug of [
      "balham",
      "barnes",
      "bermondsey-london-bridge",
      "piccadilly-soho",
      "victoria",
    ]) {
      const response = await readArea(slug);
      expect(response.status, slug).toBe(200);
      const body = (await response.json()) as { status: string };
      expect(body.status, slug).toMatch(/^(ready|unavailable)$/);
    }
  });

  it("reads Soho's own facts under the patch slug the map passes", async () => {
    loadAreaNews.mockResolvedValue({
      status: "ready",
      version: 1,
      generatedAt: "2026-09-01T00:00:00.000Z",
      entries: [
        {
          id: "soho-1",
          area: "soho",
          kind: "opening",
          title: "A new one on Frith Street",
          detail: "Opened this month.",
          sourceUrl: "https://example.com/soho",
          sourceName: "Example",
          observedAt: new Date().toISOString().slice(0, 10),
        },
      ],
    });

    const body = (await (await readArea("piccadilly-soho")).json()) as {
      status: string;
      entries: { id: string }[];
    };

    expect(body.status).toBe("ready");
    expect(body.entries.map((entry) => entry.id)).toEqual(["soho-1"]);
  });

  it("says a patch with no lane is unmeasured, never empty", async () => {
    loadAreaNews.mockClear();
    loadAreaNews.mockResolvedValue({
      status: "ready",
      version: 1,
      generatedAt: "2026-09-01T00:00:00.000Z",
      entries: [],
    });

    const uncovered = NIGHT_AREA_SLUGS.filter((slug) => !areaNewsLaneCovers(slug));
    expect(uncovered.length).toBeGreaterThan(0);

    for (const slug of uncovered) {
      const response = await readArea(slug);
      expect(response.status, slug).toBe(200);
      expect(await response.json(), slug).toEqual({
        status: "unavailable",
        entries: [],
        award: null,
      });
    }
    expect(loadAreaNews).not.toHaveBeenCalled();
  });

  it("still refuses a slug that names no place at all", async () => {
    const response = await readArea("not-an-area");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Unknown area.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
  });
});
