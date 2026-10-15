import { QUALIFIED_PRICE_REQUESTS } from "./fixtures/askPriceSubjects";
import { describe, expect, it } from "vitest";

import { refineRoutedAskQuery, routeAskDeterministically, unsupportedPriceComparison } from "@/lib/ask/router";
import { ASK_TOOL_NAMES, isAskToolName } from "@/lib/ask/types";

describe("routeAskDeterministically", () => {
  it.each([
    "Is the Tube running tonight?",
    "Are there Tube delays?",
    "Are Tube services delayed?",
    "Is transit running tonight?",
  ])("routes transit status interrogatives: %s", (query) => {
    expect(routeAskDeterministically(query)).toEqual([{ name: "city_status", args: {} }]);
  });

  it.each([
    "Find pubs near the Tube",
    "Are there pubs near the Tube?",
    "Is the pub near the Tube?",
    "Where is the Tube?",
    "How close is the Tube?",
    "Is the Tube near Fox and Anchor?",
    "Is the Tube nearby?",
    "Are Tube stations near The Lamb?",
  ])("keeps Tube proximity questions out of status routing: %s", (query) => {
    expect(routeAskDeterministically(query).map((call) => call.name)).toEqual(["search_venues"]);
  });

  it.each([
    "Is the Tube running tonight and wine prices at Fox and Anchor?",
    "Wine prices at Fox and Anchor and is the Tube running tonight?",
    "Are there Tube delays, wine prices at Fox and Anchor?",
    "Wine prices at Fox and Anchor, are there Tube delays?",
  ])("separates transit interrogatives from named category prices: %s", (query) => {
    expect(routeAskDeterministically(query)).toEqual([
      { name: "city_status", args: {} },
      { name: "venue_drinks", args: { venueName: "Fox and Anchor", drinkCategory: "wine" } },
    ]);
  });

  it.each([
    ["Pint prices at The Lamb and is the Tube running tonight?", "venue_prices"],
    ["Are there Tube delays and drink prices at Fox and Anchor?", "venue_drinks"],
    ["Is the Tube running tonight and plan a crawl in Soho?", "propose_plan"],
    ["How much is a burger in Camden and are there Tube delays?", null],
  ])("preserves the sibling request beside transit: %s", (query, tool) => {
    expect(routeAskDeterministically(query).map((call) => call.name)).toEqual(tool ? ["city_status", tool] : ["city_status"]);
  });

  it.each([
    "Is the Tube running tonight and directions to Fox and Anchor from The Lamb?",
    "Journey from The Lamb to Fox and Anchor and are there Tube delays?",
  ])("preserves explicit journey endpoints beside transit: %s", (query) => {
    expect(routeAskDeterministically(query)).toEqual([
      { name: "city_status", args: {} },
      { name: "journey", args: { from: "The Lamb", to: "Fox and Anchor" } },
    ]);
  });

  it("asks for a pub when a pint comparison has no discovery constraints", () => {
    expect(routeAskDeterministically("Cheapest pint")).toEqual([
      { name: "venue_prices", args: { venueName: "Cheapest", query: "Cheapest pint" } },
    ]);
  });

  it.each(QUALIFIED_PRICE_REQUESTS)("retains the priced subject across qualifiers: $query", ({ query, code }) => {
    expect(unsupportedPriceComparison(query)?.code).toBe(code);
    expect(routeAskDeterministically(query)).toEqual([]);
  });

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

  it.each([
    "Plan a big night for four of us, with cheap pints and a lively route",
    "Plan a night with cheap beer and a quiet crawl",
    "Plan a night with cheap lively pubs and a cosy route",
    "Plan a night with cheap pints and food and a lively route",
    "Plan a cheap quiet night in Soho for four",
    "Plan me 3 cheap pubs in Soho for four people",
  ])("preserves planning constraints in %s", (query) => {
    expect(unsupportedPriceComparison(query)).toBeNull();
    expect(routeAskDeterministically(query)).toEqual([{ name: "propose_plan", args: { query } }]);
  });

  it.each([
    "somewhere cheap and quiet",
    "Somewhere cheap in Soho",
    "Find somewhere cheap and quiet in Soho",
    "cheap quiet in Soho",
    "Find cheap quiet pubs in Soho",
    "Find cheap lively pubs in Soho for four",
    "Find cheap cosy pubs with food in Soho",
    "Find cheap riverside pubs near Bank",
    "Find cheap pubs with a beer garden in Soho",
    "Find the cheapest quiet pubs in Soho",
    "Find the cheapest pubs with a garden in Soho",
  ])("preserves venue constraints in %s", (query) => {
    expect(unsupportedPriceComparison(query)).toBeNull();
    expect(routeAskDeterministically(query)).toEqual([{ name: "search_venues", args: { query, limit: 4 } }]);
  });

  it.each([
    "Somewhere cheap and vegan curry in Soho",
    "Somewhere cheap wine in Soho",
    "Somewhere cheap Coke in Soho",
    "Burger cheapest in Camden",
    "Somewhere cheap quiet wine in Soho",
    "Somewhere cheap with food prices in Soho",
  ])("keeps unsupported item fencing for %s", (query) => {
    expect(unsupportedPriceComparison(query)).not.toBeNull();
    expect(routeAskDeterministically(query)).toEqual([]);
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

describe("routeAskDeterministically: Pub Pal V0.1 concierge tools", () => {
  it("preserves a named pub's generic recorded drink prices", () => {
    const calls = routeAskDeterministically("Drink prices at The Lamb");
    expect(calls.map((call) => call.name)).toEqual(["venue_drinks"]);
    expect(calls[0]?.args.venueName).toMatch(/^(?:the )?lamb$/i);
  });

  it.each([
    "How much is wine at The Eagle?",
    "Wine price at The Eagle",
    "What does wine cost at The Eagle?",
    "Wine prices at The Eagle",
    "Prices for wine at The Eagle",
    "Wine costs at The Eagle",
    "Costs of wine at The Eagle",
    "What are the wine prices at The Eagle?",
  ])("routes the named category-price ask %s to recorded drinks", (query) => {
    expect(routeAskDeterministically(query)).toEqual([
      { name: "venue_drinks", args: { venueName: "The Eagle", drinkCategory: "wine" } },
    ]);
  });

  it.each([
    "How much is a burger in Camden?",
    "How much is a pint and food at The Lamb?",
    "How much is a pint with food at The Lamb?",
    "Burger costs in Camden",
    "Costs for burgers in Camden",
  ])("refuses an unsupported item-price question without comparison words: %s", (query) => {
    expect(unsupportedPriceComparison(query)).not.toBeNull();
    expect(routeAskDeterministically(query)).toEqual([]);
  });

  it.each([
    "How much is a pint at The Lamb?",
    "What is the price at The Lamb?",
    "What's the price at The Lamb?",
    "Can you tell me the price at The Lamb?",
    "Prices at The Lamb",
    "Pint prices at The Lamb",
    "Pint costs at The Lamb",
    "Beer prices at The Lamb",
    "Show me the beer prices at The Lamb",
    "Price of beer at The Lamb",
    "How much is beer at The Lamb?",
  ])("preserves existing unspecified pub and pint price asks: %s", (query) => {
    expect(unsupportedPriceComparison(query)).toBeNull();
    expect(routeAskDeterministically(query).map((call) => call.name)).toEqual(["venue_prices"]);
  });

  it("keeps a conjunction inside a known place out of the price subject", () => {
    expect(unsupportedPriceComparison("How much is a pint near the Elephant and Castle")).toBeNull();
  });

  it.each([
    "Cheapest vegan food in Camden",
    "Cheapest wine in Soho",
    "Cheapest cocktails near Camden",
    "Cheapest vegan curry in Camden",
    "Cheapest Coke in Camden",
    "Cheapest sparkling water in Camden",
    "Cheapest pub lunch in Camden",
    "Plan a night with cheap burgers and a lively route",
    "Plan a night with cheap Coke and a lively route",
    "Plan a night with cheap wine and a lively route",
    "Plan a night with cheap pints and cocktails in Soho",
    "Find cheap quiet pub lunches in Soho",
    "Find cheap quiet Guinness pints in Soho",
    "Plan a night with cheap food and a lively route",
    "Plan me 3 cheap pubs in Soho for four people with wine",
    "Somewhere cheap near Elephant and Castle and wine",
  ])("does not substitute pint tools for %s", (query) => {
    expect(unsupportedPriceComparison(query)).not.toBeNull();
    expect(routeAskDeterministically(query)).toEqual([]);
  });

  it("checks recorded drinks when a wine comparison names one pub", () => {
    expect(routeAskDeterministically("Cheapest wine at The Lamb")).toEqual([
      { name: "venue_drinks", args: { venueName: "The Lamb", drinkCategory: "wine" } },
    ]);
  });

  it.each([
    "Cheapest pint in Camden",
    "Cheapest pubs with food in Camden",
    "Cheap pint and food in Camden",
  ])("preserves supported pint and food-availability asks: %s", (query) => {
    expect(routeAskDeterministically(query).length).toBeGreaterThan(0);
  });

  it("routes a cheapest-pint ask to cheapest_pint_near with the area", () => {
    const calls = routeAskDeterministically("Cheapest pint in Camden");
    expect(calls).toEqual([
      { name: "cheapest_pint_near", args: { area: "Camden" } },
    ]);
  });

  it("strips a trailing tonight from a cheapest area ask", () => {
    expect(routeAskDeterministically("Cheapest pint in Camden tonight")).toEqual([
      { name: "cheapest_pint_near", args: { area: "Camden" } },
    ]);
  });

  it("strips a trailing tonight from a now-ask so the area stays a place", () => {
    expect(routeAskDeterministically("What is on right now in Soho tonight")).toEqual([
      { name: "tonight_now", args: { area: "Soho" } },
    ]);
  });

  it("does not hand a pub or pint ask to find_desk", () => {
    expect(routeAskDeterministically("pub with wifi in Soho")[0]?.name).not.toBe(
      "find_desk",
    );
  });

  it("keeps a short pint follow-up on the current ask, not the prior desk turn", () => {
    expect(
      refineRoutedAskQuery(
        "Cheapest pint in Camden",
        "Somewhere to work with wifi in Angel",
      ),
    ).toBe("Cheapest pint in Camden");
  });

  it.each(["hi", "Hello there!", "thanks", "cheers mate"])(
    "does not fold a social prior turn (%s) into a bare area reply",
    (prior) => {
      expect(refineRoutedAskQuery("Soho", prior)).toBe("Soho");
    },
  );

  it("still borrows a substantive prior turn's place for a short follow-up", () => {
    expect(refineRoutedAskQuery("somewhere quiet", "pubs in Camden")).toBe(
      "somewhere quiet in Camden",
    );
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

  it("leaves an at-this-pub price ask with venue_prices", () => {
    for (const query of [
      "cheapest pint at The Lamb",
      "what's the cheapest pint at The Lamb",
    ]) {
      const calls = routeAskDeterministically(query);
      expect(calls.some((c) => c.name === "cheapest_pint_near")).toBe(false);
      expect(calls.some((c) => c.name === "venue_prices")).toBe(true);
    }
  });

  it("keeps an area or a near anchor on cheapest_pint_near", () => {
    expect(routeAskDeterministically("cheapest pint in Camden")[0]?.name).toBe(
      "cheapest_pint_near",
    );
    expect(
      routeAskDeterministically("cheapest pint near The Lamb")[0]?.name,
    ).toBe("cheapest_pint_near");
  });

  it("leaves a kind-named now ask with whats_on", () => {
    const calls = routeAskDeterministically("Any live music on right now in Dalston");
    expect(calls.some((c) => c.name === "tonight_now")).toBe(false);
    expect(calls[0]?.name).toBe("whats_on");
  });

  it("does not hand an area word to venue_drinks as a pub", () => {
    const calls = routeAskDeterministically("drink prices in Camden");
    expect(calls.some((c) => c.name === "venue_drinks")).toBe(false);
    expect(calls[0]?.name).toBe("search_venues");
  });

  it("does not answer a dearest ask with the cheapest list", () => {
    const calls = routeAskDeterministically("dearest pint in Soho");
    expect(calls.some((c) => c.name === "cheapest_pint_near")).toBe(false);
    expect(calls.some((c) => c.name === "venue_prices")).toBe(true);
  });
});

describe("shipped tools keep their own asks", () => {
  // One sweep, so a new concierge trigger cannot quietly take an ask off a
  // tool that answered it before the V0.1 wave existed.
  const SHIPPED: Array<[string, string]> = [
    ["Quiz tonight in Soho", "whats_on"],
    ["Any live music on right now in Dalston", "whats_on"],
    ["how much is a pint at The Lamb", "venue_prices"],
    ["cheapest pint at The Lamb", "venue_prices"],
    ["Plan a crawl in Soho for 4", "propose_plan"],
    ["Plan a crawl right now", "propose_plan"],
    ["Tell me the history of The Lamb", "venue_heritage"],
    ["Quiet-ish near Bank, 4 of us", "search_venues"],
    ["drink prices in Camden", "search_venues"],
    ["Any tube delays right now?", "city_status"],
  ];

  for (const [query, tool] of SHIPPED) {
    it(`keeps "${query}" on ${tool}`, () => {
      const calls = routeAskDeterministically(query);
      expect(calls.map((c) => c.name)).toContain(tool);
    });
  }
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
