// D11 (site audit, 13 Sep 2026): GET /api/area-news?area=bermondsey answered
// 400 "Unknown area." while soho and shoreditch answered 200. The Night Area is
// "bermondsey-london-bridge", and "bermondsey" was a display alias only, so the
// short name a reader or a caller would type named no row in the join table.
//
// The fix is a neighbourhood row, never a blanket 200: a slug that names no
// place still answers 400, so the refused / no-lane / empty three-way holds. The
// row only holds if the harvester can file a fact under it, so the join table
// and the harvest area list are fenced to agree.

import { describe, expect, it, vi } from "vitest";

import {
  areaLabel,
  areaNewsLaneCovers,
  areaNewsNeighbourhoodSlugs,
  entriesForNightArea,
  isKnownAreaSlug,
  resolveAreaBorough,
  resolveAreaNightArea,
  type AreaNewsEntry,
} from "@/lib/areaNews";
import { KNOWN_AREA_SLUGS, parseExtractedFact } from "../scripts/lib/keenableAreaNews.mjs";

const loadAreaNews = vi.hoisted(() => vi.fn());

vi.mock("@/lib/areaNews.server", () => ({ loadAreaNews }));

import { GET } from "@/app/api/area-news/route";

function readArea(area: string): Promise<Response> {
  return GET(new Request(`https://x/api/area-news?area=${encodeURIComponent(area)}`));
}

describe("area news answers Bermondsey by its short name", () => {
  it("answers bermondsey 200 ready, not 400", async () => {
    loadAreaNews.mockResolvedValue({
      status: "ready",
      version: 1,
      generatedAt: "2026-09-01T00:00:00.000Z",
      entries: [],
    });

    const response = await readArea("bermondsey");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready", entries: [] });
  });

  it("joins bermondsey to Southwark and its patch", () => {
    expect(isKnownAreaSlug("bermondsey")).toBe(true);
    expect(areaNewsLaneCovers("bermondsey")).toBe(true);
    expect(resolveAreaBorough("bermondsey")).toBe("southwark");
    expect(resolveAreaNightArea("bermondsey")).toBe("bermondsey-london-bridge");
    expect(areaLabel("bermondsey")).toBe("Bermondsey");
  });

  it("lets the harvester file a fact under every neighbourhood in the join table", () => {
    expect(areaNewsNeighbourhoodSlugs().filter((slug) => !KNOWN_AREA_SLUGS.has(slug))).toEqual([]);
  });

  it("files a harvested Bermondsey fact onto the patch slug the map passes", () => {
    const fact = parseExtractedFact(
      {
        content: JSON.stringify({
          area: "bermondsey",
          kind: "opening",
          title: "The Marquis of Wellington reopens in Bermondsey",
          detail: "The Marquis of Wellington pub reopened in Bermondsey on 27 August 2026.",
        }),
      },
      { knownAreas: KNOWN_AREA_SLUGS, currentYear: 2026, now: Date.parse("2026-09-01T00:00:00Z") },
    );

    expect(fact).toMatchObject({ area: "bermondsey", kind: "opening" });

    const entry: AreaNewsEntry = {
      ...(fact as NonNullable<typeof fact>),
      kind: "opening",
      id: "bermondsey-1",
      sourceUrl: "https://example.com/bermondsey",
      sourceName: "example.com",
      observedAt: "2026-08-27",
    };

    expect(entriesForNightArea("bermondsey-london-bridge", [entry]).map((row) => row.id)).toEqual([
      "bermondsey-1",
    ]);
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
