import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GET } from "@/app/api/night-areas/[slug]/route";
import NightAreaCoverage from "@/components/night/NightAreaCoverage";
import { getNightArea, isNightAreaRouteReady, NIGHT_AREAS } from "@/lib/nightAreas";
import { oneTapMessage, rememberedOneTapArea } from "@/lib/planOneTap";
import { listDrinkBrandAreaLandings } from "@/lib/drinkBrandAreaLanding";
import { listDrinkBrandLandings } from "@/lib/drinkBrandLanding";
import { listAreaLandings } from "@/lib/areaLanding";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";

describe("unverified Night Area reviews", () => {
  it("publishes no invented checks, review dates or readiness for the catalogue", async () => {
    expect(NIGHT_AREAS.length).toBeGreaterThan(0);
    for (const area of NIGHT_AREAS) {
      expect(area.coverageStatus).toBe("discovered");
      expect(area.coverageScore).toBe(0);
      expect(area.lastReviewedAt).toBeNull();
      expect(area.reviewExpiresAt).toBeNull();
      expect(area.routeReadyReasons).toEqual([]);
      expect(isNightAreaRouteReady(area)).toBe(false);
      expect(area.gate.passed).toBe(false);
      expect(area.gate.checks.every((check) => !check.passed && check.observed === null && check.evidenceRefs.length === 0)).toBe(true);
      expect(area.missingEvidence).toContain("opening_hours");
      expect(area.missingEvidence).toContain("terminal_get_home");
    }
    const response = await GET(new Request("http://localhost/api/night-areas/clapham"), { params: Promise.resolve({ slug: "clapham" }) });
    const area = await response.json();
    expect(area.name).toBe("Clapham");
    expect(area.gate.passed).toBe(false);
    expect(area.lastReviewedAt).toBeNull();
  });

  it("does not certify arbitrary references or fixture references", () => {
    const area = structuredClone(getNightArea("clapham"));
    area.coverageStatus = "route_ready";
    area.missingEvidence = [];
    area.lastReviewedAt = "2025-01-01T00:00:00Z";
    area.reviewExpiresAt = "2099-01-01T00:00:00Z";
    area.gate.passed = true;
    area.routeReadyReasons = area.gate.checks.map((check) => check.code);
    for (const ref of ["fixture:opening_hours:v1", "https://example.com/unverified"]) {
      for (const check of area.gate.checks) {
        check.passed = true;
        check.evidenceRefs = [ref];
      }
      expect(isNightAreaRouteReady(area)).toBe(false);
    }
  });

  it("publishes priced area-brand pages without certifying a route review", async () => {
    const venues = await loadPintPriceLandingVenues();
    const landings = listDrinkBrandAreaLandings(venues);
    expect(landings).toEqual(expect.arrayContaining([
      expect.objectContaining({ areaSlug: "victoria", brandSlug: "guinness" }),
    ]));
    for (const landing of landings) {
      expect(landing.totalPricedVenues).toBeGreaterThanOrEqual(10);
      expect(landing.areaEstimate?.basis).toBe("area_median");
      expect(isNightAreaRouteReady(getNightArea(landing.areaSlug))).toBe(false);
    }
    expect(listDrinkBrandLandings(venues).length).toBeGreaterThan(0);
    expect(listAreaLandings(venues).length).toBeGreaterThan(0);
  });

  it("offers an honest typed-area fallback without claiming a checked review", () => {
    expect(rememberedOneTapArea({ kind: "patch", id: "clapham" })).toBeNull();
    expect(oneTapMessage("out-of-range")).toContain("Type an area instead.");
    const markup = renderToStaticMarkup(createElement(NightAreaCoverage));
    expect(markup).not.toContain("Last checked 13 Jul 2026");
    expect(markup).not.toContain("Enough checked information to plan a crawl.");
    expect(markup).toContain("Not checked yet.");
  });
});
