import { describe, expect, it } from "vitest";

import { routeAskDeterministically } from "@/lib/ask/router";
import { ASK_TOOL_NAMES, isAskToolName } from "@/lib/ask/types";

describe("routeAskDeterministically", () => {
  it("routes What's On queries to whats_on only", () => {
    const calls = routeAskDeterministically("Quiz tonight in Soho");
    expect(calls).toEqual([{ name: "whats_on", args: { query: "Quiz tonight in Soho" } }]);
  });

  it("routes tube/weather asks to city_status", () => {
    const calls = routeAskDeterministically("Any tube delays right now?");
    expect(calls.some((c) => c.name === "city_status")).toBe(true);
  });

  it("routes crawl asks to propose_plan", () => {
    const calls = routeAskDeterministically("Plan a crawl in Soho for 4");
    expect(calls[0]?.name).toBe("propose_plan");
  });

  it("routes heritage asks to venue_heritage", () => {
    const calls = routeAskDeterministically("Tell me the history of The Lamb");
    expect(calls.some((c) => c.name === "venue_heritage")).toBe(true);
  });

  it("defaults mood asks to search_venues", () => {
    const calls = routeAskDeterministically("Quiet-ish near Bank, 4 of us");
    expect(calls[0]?.name).toBe("search_venues");
  });

  it("never returns more than two tools", () => {
    const calls = routeAskDeterministically(
      "Tube delays and average pint in Westminster and a crawl for 4",
    );
    expect(calls.length).toBeLessThanOrEqual(2);
  });
});

describe("Ask tool allowlist", () => {
  it("pins the ADR 0014 allowlist", () => {
    expect(ASK_TOOL_NAMES).toEqual([
      "search_venues",
      "whats_on",
      "venue_heritage",
      "venue_prices",
      "city_status",
      "journey",
      "area_buzz",
      "propose_plan",
      "propose_map_action",
    ]);
    expect(isAskToolName("search_venues")).toBe(true);
    expect(isAskToolName("web_search")).toBe(false);
  });
});
