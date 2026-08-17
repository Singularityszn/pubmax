import { afterEach, describe, expect, it, vi } from "vitest";

import { notifySitemapHistoricDegrade } from "@/lib/freshnessNotify";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notifySitemapHistoricDegrade", () => {
  it("returns a structured notice and logs through the freshness-audit ALERT group", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const notice = notifySitemapHistoricDegrade();

    expect(notice).toEqual({
      id: "historic_pubs_sitemap",
      label: "Historic pubs sitemap URLs",
      status: "unknown",
      observedAt: null,
      ageHours: null,
      detail:
        "historic pub dataset is empty or unreadable; /historic/{slug} URLs are omitted from this generation and price-derived URLs still ship",
    });
    expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const header = String(errorSpy.mock.calls[0]?.[0]);
    expect(header).toContain("[freshness-audit][ALERT]");
    expect(header).toContain("sitemap historic degrade");
    const detailLine = String(errorSpy.mock.calls[1]?.[0]);
    expect(detailLine).toContain("historic_pubs_sitemap");
    expect(detailLine).toContain("historic pub dataset is empty or unreadable");
  });
});
