// D11 (site audit, 13 Sep 2026): GET /api/area-news?area=bermondsey answered
// 400 "Unknown area." while soho and shoreditch answered 200. The Night Area is
// "bermondsey-london-bridge", and "bermondsey" was a display alias only, so the
// short name a reader or a caller would type named no row in the join table.
//
// The fix is a neighbourhood row per patch, never a blanket 200: a slug that
// names no place still answers 400, so the refused / no-lane / empty three-way
// holds. The sweep below keeps every London patch reachable from its short name.

import { describe, expect, it, vi } from "vitest";

import { LONDON_NIGHT_AREA_SLUGS } from "@/lib/nightAreas";
import {
  areaLabel,
  areaNewsLaneCovers,
  isKnownAreaSlug,
  resolveAreaBorough,
  resolveAreaNightArea,
} from "@/lib/areaNews";

const loadAreaNews = vi.hoisted(() => vi.fn());

vi.mock("@/lib/areaNews.server", () => ({ loadAreaNews }));

import { GET } from "@/app/api/area-news/route";

function readArea(area: string): Promise<Response> {
  return GET(new Request(`https://x/api/area-news?area=${encodeURIComponent(area)}`));
}

const READY_EMPTY = {
  status: "ready",
  version: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
  entries: [],
};

// Each London patch whose slug is not the name a reader types, with that name.
const SHORT_NAMES = [
  { area: "bermondsey", borough: "southwark", nightArea: "bermondsey-london-bridge", label: "Bermondsey" },
  { area: "victoria", borough: "westminster", nightArea: "victoria", label: "Victoria" },
  { area: "balham", borough: "wandsworth", nightArea: "balham", label: "Balham" },
  { area: "barnes", borough: "richmond-upon-thames", nightArea: "barnes", label: "Barnes" },
] as const;

describe("area news answers a London patch by its short name", () => {
  it("answers bermondsey 200 ready, not 400", async () => {
    loadAreaNews.mockResolvedValue(READY_EMPTY);

    const response = await readArea("bermondsey");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready", entries: [] });
  });

  it.each(SHORT_NAMES)("joins $area to its borough and patch", ({ area, borough, nightArea, label }) => {
    expect(isKnownAreaSlug(area)).toBe(true);
    expect(areaNewsLaneCovers(area)).toBe(true);
    expect(resolveAreaBorough(area)).toBe(borough);
    expect(resolveAreaNightArea(area)).toBe(nightArea);
    expect(areaLabel(area)).toBe(label);
  });

  it("gives every London patch a news lane", () => {
    expect(LONDON_NIGHT_AREA_SLUGS.filter((slug) => !areaNewsLaneCovers(slug))).toEqual([]);
  });

  it("reads Bermondsey's own facts under the patch slug the map passes", async () => {
    loadAreaNews.mockResolvedValue({
      ...READY_EMPTY,
      entries: [
        {
          id: "bermondsey-1",
          area: "bermondsey",
          kind: "opening",
          title: "A new taproom under the arches",
          detail: "Opened this month.",
          sourceUrl: "https://example.com/bermondsey",
          sourceName: "Example",
          observedAt: new Date().toISOString().slice(0, 10),
        },
      ],
    });

    const body = (await (await readArea("bermondsey-london-bridge")).json()) as {
      status: string;
      entries: { id: string }[];
    };

    expect(body.status).toBe("ready");
    expect(body.entries.map((entry) => entry.id)).toEqual(["bermondsey-1"]);
  });

  it("still refuses a slug that names no place at all", async () => {
    loadAreaNews.mockClear();

    const response = await readArea("bermondsey-nowhere");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Unknown area.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
    expect(loadAreaNews).not.toHaveBeenCalled();
  });
});
