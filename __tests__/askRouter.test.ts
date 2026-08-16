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

describe("routeAskDeterministically — Pub Pal V0.1 concierge tools", () => {
  it("routes a cheapest-pint ask to cheapest_pint_near with the area", () => {
    const calls = routeAskDeterministically("Cheapest pint in Camden");
    expect(calls).toEqual([
      { name: "cheapest_pint_near", args: { area: "Camden" } },
    ]);
  });

  it("keeps a cheap CRAWL on propose_plan", () => {
    const calls = routeAskDeterministically("Plan a cheapest crawl in Soho");
    expect(calls.some((c) => c.name === "cheapest_pint_near")).toBe(false);
    expect(calls.some((c) => c.name === "propose_plan")).toBe(true);
  });

  it("routes a right-now ask to tonight_now", () => {
    const calls = routeAskDeterministically("What is on right now in Shoreditch");
    expect(calls).toEqual([{ name: "tonight_now", args: { area: "Shoreditch" } }]);
  });

  it("leaves a tube ask with city_status even though it says right now", () => {
    const calls = routeAskDeterministically("Any tube delays right now?");
    expect(calls.some((c) => c.name === "tonight_now")).toBe(false);
    expect(calls.some((c) => c.name === "city_status")).toBe(true);
  });

  it("routes a work ask to find_desk", () => {
    const calls = routeAskDeterministically(
      "Somewhere to work with wifi in Angel",
    );
    expect(calls).toEqual([{ name: "find_desk", args: { area: "Angel" } }]);
  });

  it("routes a drinks-list ask to venue_drinks", () => {
    const calls = routeAskDeterministically("What's on tap at The Lamb");
    expect(calls[0]?.name).toBe("venue_drinks");
    expect(String(calls[0]?.args.venueName)).toContain("Lamb");
  });

  it("routes a crowd report to report_occupancy and answers alone", () => {
    const calls = routeAskDeterministically("It's rammed in The Lamb");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("report_occupancy");
    expect(String(calls[0]?.args.venueName)).toContain("Lamb");
  });

  it("still defaults an ordinary mood ask to search_venues", () => {
    const calls = routeAskDeterministically("Quiet-ish near Bank, 4 of us");
    expect(calls[0]?.name).toBe("search_venues");
  });

  it("leaves a quiet-pub ask with the venue search", () => {
    const calls = routeAskDeterministically("Somewhere it's quiet in Soho");
    expect(calls.some((c) => c.name === "report_occupancy")).toBe(false);
    expect(calls[0]?.name).toBe("search_venues");
  });

  it("keeps a plan ask on propose_plan when it says right now", () => {
    const calls = routeAskDeterministically("Plan a crawl right now");
    expect(calls.some((c) => c.name === "tonight_now")).toBe(false);
    expect(calls.some((c) => c.name === "propose_plan")).toBe(true);
  });

  it("keeps a price ask on venue_prices when it says right now", () => {
    const calls = routeAskDeterministically(
      "how much is a pint right now at The Lamb",
    );
    expect(calls.some((c) => c.name === "tonight_now")).toBe(false);
    expect(calls.some((c) => c.name === "venue_prices")).toBe(true);
  });

  it("does not answer a dearest ask with the cheapest list", () => {
    const calls = routeAskDeterministically("dearest pint in Soho");
    expect(calls.some((c) => c.name === "cheapest_pint_near")).toBe(false);
    expect(calls.some((c) => c.name === "venue_prices")).toBe(true);
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
      "cheapest_pint_near",
      "tonight_now",
      "venue_drinks",
      "find_desk",
      "report_occupancy",
    ]);
    expect(isAskToolName("search_venues")).toBe(true);
    expect(isAskToolName("web_search")).toBe(false);
  });
});
