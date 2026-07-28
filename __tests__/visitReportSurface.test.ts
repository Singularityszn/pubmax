import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("Visit Report venue surface", () => {
  it("ships one dated, bounded composer and individual report actions", () => {
    const panel = source("components/visits/VisitReportPanel.tsx");

    expect(panel).toContain('type="date"');
    expect(panel).toContain("MAX_VISIT_NOTE");
    expect(panel).toContain("read.reports");
    expect(panel).toContain("reportVisitReport");
    expect(panel).toContain("visitedAt");
    expect(panel).not.toContain("VisitReportSummary");
    expect(panel).not.toContain("summary");
  });

  it("mounts the shared lane in the map venue sheet", () => {
    const storyTab = source("components/map/inspector/VenueStoryTab.tsx");

    expect(storyTab).toContain('import VisitReportPanel from "@/components/visits/VisitReportPanel"');
    expect(storyTab).toContain("<VisitReportPanel");
  });

  it("keeps all interactive controls thumb-sized at phone width", () => {
    const css = source("components/visits/visitReports.css");

    expect(css).toMatch(/\.visitChip[\s\S]*min-height:\s*44px/);
    expect(css).toMatch(/\.visitReportSubmit[\s\S]*min-height:\s*44px/);
    expect(css).toMatch(/\.visitReportFlag[\s\S]*min-height:\s*44px/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("does not place a venue star score beside a visit account", () => {
    const ledger = source("app/ledger/[id]/page.tsx");
    const barTab = source("app/bar-tab/[id]/page.tsx");
    const discover = source("app/discover/DiscoverPageClient.tsx");

    expect(ledger).not.toContain("VenueRatingPanel");
    expect(barTab).not.toContain("VenueRatingPanel");
    expect(discover).not.toContain("TopRatedPubs");
  });
});
