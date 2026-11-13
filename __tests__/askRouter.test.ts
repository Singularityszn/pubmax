import { QUALIFIED_PRICE_REQUESTS } from "./fixtures/askPriceSubjects";
import { GENERIC_MAP_COMMANDS, SOCIAL_MAP_COMMANDS, priceMapMetadataRequests, serviceBesideMap } from "./fixtures/askMapCommands";
import { describe, expect, it } from "vitest";

import { isVenueDiscoveryAsk, isVenueHoursQuestion, refineRoutedAskQuery, resolveAskJourney, routeAskDeterministically, socialTurnKind, unsupportedPriceComparison } from "@/lib/ask/router";
import { palVoiceMapIntent } from "@/lib/palVoiceTranscript";
import { semanticAskRequest } from "@/lib/ask/requestPolicy";
import { parseConciergeIntent } from "@/lib/concierge/intent";
import { ASK_TOOL_NAMES, isAskToolName } from "@/lib/ask/types";

describe("routeAskDeterministically", () => {
  it.each(["tonight", "right now", "now", "later", "today", "this evening", "this afternoon", "this morning", "this weekend"])("keeps map time tails outside both semantic views: %s", (time) => {
    const map = `Open the full map for ${time}`;
    const query = `What's on in Soho on Friday. ${map}.`;
    expect(semanticAskRequest(query, false)).toBe("What's on in Soho on Friday.");
    expect(semanticAskRequest(query)).toBe("What's on in Soho on Friday. Open the full map");
    expect(palVoiceMapIntent(map, false)).toBe("map");
  });

  it.each(priceMapMetadataRequests("Find three quiet pubs in Soho."))(
    "keeps complete map price metadata outside discovery: %s", async (query) => {
      expect(unsupportedPriceComparison(query)).toBeNull();
      expect(routeAskDeterministically(query)).toEqual([{ name: "search_venues", args: { query, limit: 3 } }]);
      expect((await parseConciergeIntent(query, { skipModel: true })).intent).toEqual({ mood: ["quiet"], area: "Soho", groupSize: 2 });
    },
  );

  it.each([
    "Directions to The Harp from London Bridge",
    "Directions from London Bridge to The Harp",
  ].flatMap(priceMapMetadataRequests))("keeps journey endpoints outside map price metadata: %s", (query) => {
    expect(resolveAskJourney(query)).toEqual({ from: "London Bridge", to: "The Harp" });
    expect(routeAskDeterministically(query)).toEqual([{ name: "journey", args: { from: "London Bridge", to: "The Harp" } }]);
  });

  it.each(priceMapMetadataRequests("Cheapest pint near Soho"))(
    "keeps supported pint comparison beside map price metadata: %s", (query) => {
      expect(unsupportedPriceComparison(query)).toBeNull();
      expect(routeAskDeterministically(query).map(({ name }) => name)).toEqual(["cheapest_pint_near"]);
    },
  );

  it.each([
    "Cheap pints in Soho for four on Friday",
    "Cheap pints in Soho for 8 of us on Friday night",
    "Cheap pints in Soho for four this Friday",
  ])("keeps a pint ask with a group size and a day supported: %s", (query) => {
    expect(unsupportedPriceComparison(query)).toBeNull();
    expect(routeAskDeterministically(query).map(({ name }) => name)).toEqual(["search_venues"]);
  });

  it.each(["Cheapest pint in Soho for 4 on Saturday", "Cheapest pint in Soho for four next Friday"])(
    "keeps the area clean of a group size and a day: %s", (query) => {
      expect(routeAskDeterministically(query)).toEqual([{ name: "cheapest_pint_near", args: { area: "Soho" } }]);
    },
  );

  it("still refuses an unsupported drink with a group size and a day", () => {
    expect(unsupportedPriceComparison("Cheapest Negroni in Soho for four on Friday")).not.toBeNull();
  });

  it.each(["Cheapest Negroni near Soho", "Cheapest burger near Soho", "Cheapest wine near Soho"].flatMap(priceMapMetadataRequests))(
    "keeps unsupported comparisons refused beside map price metadata: %s", (query) => {
      expect(unsupportedPriceComparison(query)).not.toBeNull();
      expect(routeAskDeterministically(query)).toEqual([]);
    },
  );

  it("does not turn a metadata-only map field into a price request or navigation", () => {
    const query = "Show the map for any price you use";
    expect(unsupportedPriceComparison(query)).toBeNull();
    expect(routeAskDeterministically(query)).toEqual([]);
    expect(palVoiceMapIntent(query, false)).toBeNull();
  });

  it.each(priceMapMetadataRequests("Where is The Harp?"))(
    "retains a named target beside complete map price metadata: %s", (query) => {
      expect(unsupportedPriceComparison(query)).toBeNull();
      expect(palVoiceMapIntent(query, false)).toBe("pub");
    },
  );

  it.each(["Show The Harp on the map", "Show The Garden on the map", "Open The Sportsman on the map", "Take me to The Harp"])(
    "preserves a named map subject containing possible constraints: %s", (request) => {
      const evidence = "Show the source and date for any price you use.";
      for (const query of [request, `${evidence} ${request}`, `${request}. ${evidence}`]) {
        expect(palVoiceMapIntent(query, false)).toBe("pub");
      }
    },
  );

  it.each(GENERIC_MAP_COMMANDS)("separates supported map commands from all discovery constraints: %s", async (map) => {
    for (const service of ["Date night", "Garden", "For four", "Near Soho", "Under £6", "Quiet-ish near Bank, 4 of us"]) {
      for (const query of serviceBesideMap(service, map)) {
        expect(palVoiceMapIntent(query, false)).toBeNull();
        expect(routeAskDeterministically(query)).toEqual([{ name: "search_venues", args: { query, limit: 4 } }]);
        const { intent } = await parseConciergeIntent(query, { skipModel: true });
        if (service === "Date night") expect(intent.mood).toContain("date");
        if (service === "Garden") expect(intent.mood).toContain("garden");
        if (service === "For four") expect(intent.groupSize).toBe(4);
        if (service === "Near Soho") expect(intent.area).toBe("Soho");
        if (service === "Under £6") expect(intent.maxPintPrice).toBe(6);
      }
    }
  });

  it.each(GENERIC_MAP_COMMANDS)("keeps service subjects beside every supported map command: %s", (map) => {
    for (const service of ["Directions to The Harp from London Bridge", "Directions from London Bridge to The Harp", "How do I get from London Bridge to The Harp?"]) {
      for (const query of serviceBesideMap(service, map)) {
        expect(resolveAskJourney(query)).toEqual({ from: "London Bridge", to: "The Harp" });
        expect(routeAskDeterministically(query)).toEqual([{ name: "journey", args: { from: "London Bridge", to: "The Harp" } }]);
      }
    }
    for (const query of serviceBesideMap("Any Tube delays?", map)) {
      expect(palVoiceMapIntent(query, false)).toBeNull();
      expect(routeAskDeterministically(query)).toEqual([{ name: "city_status", args: {} }]);
    }
    for (const query of serviceBesideMap("Cheapest pint near Soho", map)) {
      expect(unsupportedPriceComparison(query)).toBeNull();
      expect(routeAskDeterministically(query).map(({ name }) => name)).toEqual(["cheapest_pint_near"]);
    }
    for (const service of ["Cheapest Negroni near Soho", "Cheapest burger near Soho", "Cheapest wine near Soho"]) {
      for (const query of serviceBesideMap(service, map)) {
        expect(unsupportedPriceComparison(query)).not.toBeNull();
        expect(routeAskDeterministically(query)).toEqual([]);
      }
    }
  });

  it.each([
    "OK. Show me the map",
    "Alright, show me the map",
    "Great. Show the map",
    "That sounds good. Show me the map",
    "In fact, show me the map",
    ...SOCIAL_MAP_COMMANDS,
  ])("keeps acknowledgement map actions without inheriting an area: %s", (request) => {
    const evidence = "Show the source and date for any price you use";
    for (const query of [request, evidence + ". " + request, request + " and " + evidence]) {
      expect(palVoiceMapIntent(semanticAskRequest(query), false)).toBe("map");
      expect(routeAskDeterministically(query).map((call) => call.name)).toEqual(["propose_map_action"]);
      expect(refineRoutedAskQuery(query, "Find four pubs in Camden")).toBe(query);
    }
  });

  it.each(["Quiet-ish near Bank, 4 of us.", "Near Soho.", "For four.", "Date night.", "Garden."])(
    "keeps implicit discovery constraints ahead of the map: %s", (request) => {
      for (const query of [request + " Show the map.", "Show the map. " + request]) {
        expect(routeAskDeterministically(query)).toEqual([
          { name: "search_venues", args: { query, limit: 4 } },
        ]);
      }
    },
  );

  it.each(["Date night", "For four", "Near Soho", "Under £6", "Garden", "Quiet-ish near Bank, 4 of us", "Any Tube delays?"])(
    "keeps an unpunctuated service prefix ahead of navigation: %s", (service) => {
      const query = `${service} show me the map`;
      expect(semanticAskRequest(query, false)).toBe(service);
      expect(palVoiceMapIntent(query, false)).toBeNull();
      expect(routeAskDeterministically(query)).toEqual(service === "Any Tube delays?"
        ? [{ name: "city_status", args: {} }]
        : [{ name: "search_venues", args: { query, limit: 4 } }]);
    },
  );

  it.each([
    "Hi. Show me the map",
    "Show the map. Hi",
    "Thanks and show me the map",
    "Please show the map",
    "Hi; could you please show me the map",
  ])("preserves bare map commands beside social and polite text: %s", (request) => {
    const evidence = "Show the source and date for any price you use";
    for (const boundary of [". ", "; ", ", ", " and "]) {
      for (const query of [request, `${evidence}${boundary}${request}`, `${request}${boundary}${evidence}`, `${evidence}${boundary}${request}${boundary}${evidence} and include the date`]) {
        const semantic = semanticAskRequest(query);
        expect(palVoiceMapIntent(semantic, false)).toBe("map");
        expect(socialTurnKind(query)).toBeNull();
        expect(routeAskDeterministically(query).map((call) => call.name)).toEqual(["propose_map_action"]);
      }
    }
  });

  it.each([
    "Show me the map and any tube delays?",
    "Any tube delays? Show the map",
  ])("preserves map intent and service ownership beside another request: %s", (query) => {
    expect(palVoiceMapIntent(semanticAskRequest(query), false)).toBeNull();
    expect(socialTurnKind(query)).toBeNull();
    expect(routeAskDeterministically(query)).toEqual([{ name: "city_status", args: {} }]);
  });

  it.each([
    "Hi. Show the map for any price you use",
    "Show the source and date and map for every price you quote. Hi.",
  ])("keeps price-evidence map fields as metadata: %s", (query) => {
    expect(palVoiceMapIntent(semanticAskRequest(query), false)).toBeNull();
    expect(socialTurnKind(query)).toBe("greeting");
  });

  it.each([
    { first: "Directions to The Lamb from London Bridge", second: "any tube delays?", tools: ["city_status", "journey"], journey: { from: "London Bridge", to: "The Lamb" } },
    { first: "How much is a pint at The Lamb", second: "directions to Soho", tools: ["journey", "venue_prices"], journey: { to: "Soho" }, venueName: "The Lamb" },
    { first: "What are the opening hours at The Lamb", second: "any tube delays?", tools: ["city_status", "search_venues"] },
    { first: "Show wine prices in Soho", second: "directions to The Lamb from London Bridge", tools: ["journey"], journey: { from: "London Bridge", to: "The Lamb" }, unsupported: "UNSUPPORTED_DRINK_PRICE_COMPARISON" },
    { first: "Find pubs with burger prices in Soho", second: "directions to The Lamb from London Bridge", tools: ["journey"], journey: { from: "London Bridge", to: "The Lamb" }, unsupported: "UNSUPPORTED_FOOD_PRICE_COMPARISON" },
  ])("keeps surviving requests separate around middle evidence: $first / $second", ({ first, second, tools, journey, venueName, unsupported }) => {
    const evidence = "show the source and date for any price you use";
    for (const [left, right] of [[first, second], [second, first]]) {
      for (const boundary of [" and ", ". ", ", ", "; "]) {
        for (const middle of [evidence, `${evidence} and include sources and dates for every price you quote`]) {
          const query = `${left}${boundary}${middle}${boundary}${right}`;
          const calls = routeAskDeterministically(query);
          expect(calls.map((call) => call.name)).toEqual(tools);
          if (journey) expect(resolveAskJourney(query)).toEqual(journey);
          if (venueName) expect(calls.find((call) => call.name === "venue_prices")?.args).toEqual({ venueName, query });
          expect(unsupportedPriceComparison(query)?.code).toBe(unsupported);
        }
      }
    }
  });

  it.each(["Show me the map", "Show the map", "Show The Lamb on the map"])("keeps genuine map intent through the shared policy: %s", (request) => {
    const evidence = "Show the source and date for any price you use";
    for (const query of [request, `${evidence}. ${request}`, `${request} and ${evidence}`, `${evidence}. ${request} and ${evidence}`]) {
      expect(palVoiceMapIntent(semanticAskRequest(query), false)).toBe(request.includes("Lamb") ? "pub" : "map");
      if (!request.includes("Lamb")) expect(palVoiceMapIntent(query, false)).toBe("map");
      expect(routeAskDeterministically(query).map((call) => call.name)).toEqual(["propose_map_action"]);
    }
  });

  it.each([
    "Quiet-ish near Bank, 4 of us. Show the source and date for any price you use.",
    "Quiet-ish near Bank, 4 of us. Show the map.",
  ])("keeps the reproduced mood-only request on discovery: %s", (query) => {
    expect(routeAskDeterministically(query)).toEqual([{ name: "search_venues", args: { query, limit: 4 } }]);
  });

  it.each([
    { request: "Quiet-ish near Bank, 4 of us.", name: "search_venues", args: { limit: 4 }, queryContext: true },
    { request: "Find three quiet pubs in Soho for four people under £7 a pint.", name: "search_venues", args: { limit: 3 }, queryContext: true },
    { request: "Plan a quiet romantic crawl in Soho for four people under £7 a pint.", name: "propose_plan", args: {}, queryContext: true },
    { request: "How much is a pint at The Lamb?", name: "venue_prices", args: { venueName: "The Lamb" }, queryContext: true },
    { request: "What are the opening hours at The Lamb?", name: "search_venues", args: {}, queryContext: true },
    { request: "What's on in Soho tonight?", name: "whats_on", args: {}, queryContext: true },
    { request: "History of Mr. Fogg's", name: "venue_heritage", args: {}, queryContext: true },
    { request: "Show The Lamb on the map", name: "propose_map_action", args: { venueName: "Lamb on map" }, queryContext: false },
    { request: "Directions to Mr. Fogg's from London Bridge.", name: "journey", args: { from: "London Bridge", to: "Mr. Fogg's" }, queryContext: false },
    { request: "Is the Tube running tonight?", name: "city_status", args: {}, queryContext: false },
    { request: "Weather in London", name: "city_status", args: {}, queryContext: false },
    { request: "Cheapest pint in Camden", name: "cheapest_pint_near", args: { area: "Camden" }, queryContext: false },
    { request: "Cheapest wine at The Lamb", name: "venue_drinks", args: { venueName: "The Lamb", drinkCategory: "wine" }, queryContext: false },
    { request: "Drink prices in Camden", name: "search_venues", args: { limit: 4 }, queryContext: true },
    { request: "How much is a burger at The Lamb?", name: "venue_drinks", args: { venueName: "The Lamb" }, queryContext: false },
    { request: "What's the buzz in Soho", name: "area_buzz", args: { area: "Soho" }, queryContext: false },
    { request: "Somewhere to work with wifi in Angel", name: "find_desk", args: { area: "Angel" }, queryContext: false },
    { request: "What is on right now in Soho tonight", name: "tonight_now", args: { area: "Soho" }, queryContext: false },
    { request: "It's rammed in The Lamb", name: "report_occupancy", args: { venueName: "Lamb", level: "It's rammed in The Lamb" }, queryContext: false },
  ])("keeps semantic routing and raw context for $request", ({ request, name, args, queryContext }) => {
    const evidence = "Show the source and date for any price you use.";
    for (const query of [request, `${evidence} ${request}`, `${request} and ${evidence}`, `${request} and Show the map.`, `${evidence} Include the map. ${request} and ${evidence}`]) {
      expect(routeAskDeterministically(query)).toEqual([
        { name, args: { ...args, ...(queryContext ? { query } : {}) } },
      ]);
    }
  });

  it("uses semantic requests at exported helper boundaries", async () => {
    const evidence = "Show the source and date for any price you use.";
    for (const wrap of [(request: string) => `${evidence} ${request}`, (request: string) => `${request} and ${evidence} Include the map.`]) {
      expect(isVenueHoursQuestion(wrap("What are the opening hours at The Lamb?"))).toBe(true);
      expect(isVenueHoursQuestion(wrap("Find pubs with late opening hours in Soho."))).toBe(false);
      expect(isVenueDiscoveryAsk(wrap("Somewhere quiet in Soho."))).toBe(true);
      expect(isVenueDiscoveryAsk(wrap("How much is a pint at The Lamb?"))).toBe(false);
      expect(resolveAskJourney(wrap("Directions to Mr. Fogg's from London Bridge."))).toEqual({ from: "London Bridge", to: "Mr. Fogg's" });
      const followUp = wrap("somewhere quiet");
      const refined = refineRoutedAskQuery(followUp, wrap("pubs in Camden"));
      expect(refined).toContain(followUp);
      expect((await parseConciergeIntent(refined, { skipModel: true })).intent).toMatchObject({ area: "Camden", mood: ["quiet"] });
      expect(routeAskDeterministically(refined)).toEqual([{ name: "search_venues", args: { query: refined, limit: 4 } }]);
      const budget = wrap("Same area, under £6.50 a pint.");
      expect(refineRoutedAskQuery(budget, wrap("Find four pubs in Soho."))).toBe(wrap("pubs in Soho, under £6.50 a pint."));
    }
    expect(socialTurnKind(`${evidence} Hello mate.`)).toBe("greeting");
    expect(socialTurnKind(`Hello mate. and ${evidence} Include the map.`)).toBeNull();
  });

  it.each([
    "Recommend three quiet pubs in Soho.",
    "Suggest three quiet pubs.",
    "Sort me a night in Soho.",
    "Directions to Mr. Fogg's from London Bridge.",
  ])("removes a complete leading presentation clause without rewriting %s", (request) => {
    for (const boundary of [". ", "? ", "; ", ", ", " and "]) {
      const query = `Show the source and date for any price you use${boundary}${request}`;
      expect(semanticAskRequest(query)).toBe(request);
    }
    expect(semanticAskRequest(request)).toBe(request);
  });

  it.each([
    "Recommend three quiet pubs in Soho for four people under £7 a pint.",
    "Suggest three quiet date-night pubs in Soho.",
    "Sort me a quiet night in Soho for four people under £7 a pint.",
    "How much is a pint at The Lamb?",
    "Directions to Mr. Fogg's from London Bridge.",
    "Find pubs with burger prices in Soho.",
    "Show wine prices in Soho.",
  ])("removes adjacent evidence instructions once and preserves %s", (request) => {
    for (const boundary of [". ", "? ", "! ", "; ", ", ", " and ", ". and ", "; and "]) {
      const evidence = `Show sources for any price you use${boundary}could you please show the date for every price you quote${boundary}include the map`;
      for (const { query, expected } of [
        { query: `${evidence}. ${request}`, expected: `include the map. ${request}` },
        { query: `${request} ${evidence}.`, expected: `${request} include the map` },
      ]) {
        const semantic = semanticAskRequest(query);
        expect(semantic).toBe(expected);
        expect(semanticAskRequest(semantic)).toBe(expected);
      }
    }
  });

  it("keeps discovery after a leading request for price evidence", () => {
    const query = "Show the source and date for any price you use. Find three quiet pubs in Soho for tonight.";
    expect(unsupportedPriceComparison(query)).toBeNull();
    expect(routeAskDeterministically(query)).toEqual([
      { name: "search_venues", args: { query, limit: 3 } },
    ]);
  });

  it.each([
    "Show the source and date for any price you use. Recommend three quiet pubs in Soho.",
    "Show the source and date for any price you use. Suggest three quiet pubs",
    "Find three quiet pubs in Soho. Show sources for any price you use and show the date for every price you quote.",
    "Show sources for any price you use and please show the date for every price you quote. Recommend three quiet pubs in Soho.",
    "Find three quiet pubs in Soho for tonight. Show the source and date for any price you use.",
    "Find three quiet pubs in Soho and please include sources and dates for every price you quote",
    "Find three quiet pubs in Soho. Show the source and date for any price you use tonight.",
    "Find three quiet pubs in Soho, could you please include sources and dates for every price you quote?",
    "Find three pubs in Soho and include sources and dates for every price you quote.",
    "Find three pubs in Soho. Please give me recorded dates and the source for each listed pint price.",
  ])("keeps pub discovery with a price-evidence instruction: %s", (query) => {
    expect(unsupportedPriceComparison(query)).toBeNull();
    expect(routeAskDeterministically(query)).toEqual([
      { name: "search_venues", args: { query, limit: 3 } },
    ]);
  });

  it.each([
    "Plan a crawl in Soho. Show the source and date for any price you mention.",
    "Show the source and date for any price you use. Sort me a night in Soho",
    "Show sources for any price you use and show the date for every price you quote. Sort me a night in Soho for four people under £7 a pint.",
    "Plan a quiet crawl in Soho. Show sources for any price you use; and please show the date for every price you quote.",
    "Show the source and date for any price you use. Plan a quiet crawl in Soho.",
    "Plan a quiet crawl in Soho and please include sources and dates for every price you quote",
  ])("keeps planning with a price-evidence instruction: %s", (query) => {
    expect(unsupportedPriceComparison(query)).toBeNull();
    expect(routeAskDeterministically(query)).toEqual([{ name: "propose_plan", args: { query } }]);
  });

  it.each([
    "Show the source and date for any price you use. How much is a pint at The Lamb?",
    "Show sources for any price you use and show the date for every price you quote. How much is a pint at The Lamb?",
    "How much is a pint at The Lamb? Show sources for any price you use and show the date for every price you quote.",
    "How much is a pint at The Lamb? Please include sources and dates for every price you quote.",
    "How much is a pint at The Lamb and please include sources and dates for every price you quote",
  ])("keeps the named pint subject beside evidence instructions: %s", (query) => {
    expect(unsupportedPriceComparison(query)).toBeNull();
    expect(routeAskDeterministically(query)).toEqual([
      { name: "venue_prices", args: { venueName: "The Lamb", query } },
    ]);
  });

  it.each([
    ["Show the source and date for any price you use. Recommend pubs with burger prices in Soho.", "UNSUPPORTED_FOOD_PRICE_COMPARISON"],
    ["Show the source and date for any price you use. Suggest pubs with wine prices in Soho.", "UNSUPPORTED_DRINK_PRICE_COMPARISON"],
    ["Show sources for any price you use and show the date for every price you quote and show wine prices in Soho.", "UNSUPPORTED_DRINK_PRICE_COMPARISON"],
    ["Show sources for any price you use and show the date for every price you quote. Find pubs with burger prices in Soho.", "UNSUPPORTED_FOOD_PRICE_COMPARISON"],
    ["Find pubs with burger prices in Soho. Show sources for any price you use and show the date for every price you quote.", "UNSUPPORTED_FOOD_PRICE_COMPARISON"],
    ["Show wine prices in Soho and show sources for any price you use and show the date for every price you quote.", "UNSUPPORTED_DRINK_PRICE_COMPARISON"],
    ["Show the source and date for any price you use. Sort me a night with burger prices in Soho.", "UNSUPPORTED_FOOD_PRICE_COMPARISON"],
    ["Find three pubs in Soho. Show the source and date for any burger price you use.", "UNSUPPORTED_FOOD_PRICE_COMPARISON"],
    ["Find three pubs in Soho. Show the source and date for any wine price you use.", "UNSUPPORTED_DRINK_PRICE_COMPARISON"],
    ["Find three pubs in Soho. Show the source and date for any price you use and show wine prices.", "UNSUPPORTED_DRINK_PRICE_COMPARISON"],
    ["Show the source and date for any price you use. Find pubs with burger prices in Soho.", "UNSUPPORTED_FOOD_PRICE_COMPARISON"],
    ["Find pubs with burger prices in Soho and please include sources and dates for every price you quote", "UNSUPPORTED_FOOD_PRICE_COMPARISON"],
    ["Please include sources and dates for every price you quote. How much is wine in Soho?", "UNSUPPORTED_DRINK_PRICE_COMPARISON"],
    ["Find three pubs in Soho and please include sources and dates for every price you quote and show wine prices", "UNSUPPORTED_DRINK_PRICE_COMPARISON"],
  ])("retains the item guard beside price-evidence wording: %s", (query, code) => {
    expect(unsupportedPriceComparison(query)?.code).toBe(code);
    expect(routeAskDeterministically(query)).toEqual([]);
  });

  it.each([
    "Show the source and date for any price you use. Directions to Mr. Fogg's from London Bridge.",
    "Directions to Mr. Fogg's from London Bridge. Show the source and date for any price you use.",
    "Show sources for any price you use and show the date for every price you quote. Directions to Mr. Fogg's from London Bridge.",
    "Directions to Mr. Fogg's from London Bridge. Show sources for any price you use and show the date for every price you quote.",
    "Directions to Mr. Fogg's from London Bridge and please include sources and dates for every price you quote",
  ])("preserves punctuation and journey endpoints beside evidence instructions: %s", (query) => {
    const semantic = semanticAskRequest(query);
    expect(semantic).toMatch(/^Directions to Mr\. Fogg's from London Bridge\.?$/);
    expect(resolveAskJourney(semantic)).toEqual({ from: "London Bridge", to: "Mr. Fogg's" });
    expect(resolveAskJourney(query)).toEqual({ from: "London Bridge", to: "Mr. Fogg's" });
  });

  it.each([
    "Find me three pubs near Soho with listed pint prices. Show the source dates and the map.",
    "Find me 3 pubs near Soho with recorded pint prices. Include sources and the map.",
    "Find me three pubs in Soho with pint prices and show the map",
  ])("recognises sourced pint discovery with a requested count and map: %s", (query) => {
    expect(unsupportedPriceComparison(query)).toBeNull();
    expect(routeAskDeterministically(query)).toEqual([
      { name: "search_venues", args: { query, limit: 3 } },
    ]);
  });
  it.each([
    "Find me three pubs near Soho with listed pint prices. How much is a burger? Show the source dates and the map.",
    "Find me three pubs near Soho with listed pint prices. Show wine prices and source dates.",
    "Find me three pubs near Soho with listed pint and burger prices. Show the source dates and the map.",
  ])("keeps unsupported items beside presentation requests: %s", (query) => {
    expect(unsupportedPriceComparison(query)).not.toBeNull();
    expect(routeAskDeterministically(query)).toEqual([]);
  });
  it.each([
    ["1", 1], ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6],
    ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6],
  ])(
    "preserves counted hours discovery for %s pubs", (count, limit) => {
      const query = `Find me ${count} quiet local pub in Soho with late opening hours`;
      expect(routeAskDeterministically(query)).toEqual([{ name: "search_venues", args: { query, limit } }]);
    },
  );
  it.each([
    ["Find me two quiet pubs in Soho", 2],
    ["Show me 6 pubs in Soho on the map", 6],
    ["Find me three good places in Soho for six people", 3],
    ["Find pubs in Soho for two people", 4],
  ])("keeps the requested choices separate from the group size: %s", (query, limit) => {
    expect(routeAskDeterministically(String(query))).toEqual([
      { name: "search_venues", args: { query, limit } },
    ]);
  });
  it.each([
    "Find me four pubs in Soho and show them on the map.",
    "Show me quiet pubs in Soho on the map",
    "Show me four pubs in Soho",
    "Find four pubs in Soho under £6 a pint.",
    "Find me a pub in Soho with late opening hours",
    "Find me a quiet pub in Soho with late opening hours",
    "Find me a welcoming dog-friendly pub in Soho with late opening hours",
    "Show me pubs in Soho with late closing times",
    "Find somewhere in Soho with late opening times",
    "What are the opening hours of a quiet pub in Soho?",
    "What are the closing times for any welcoming dog-friendly pub in Soho?",
    "A welcoming dog-friendly pub in Soho with late opening hours",
  ])("answers discovery before offering map actions: %s", (query) => {
    expect(routeAskDeterministically(query)).toEqual([
      { name: "search_venues", args: { query, limit: 4 } },
    ]);
  });

  it.each([
    "What are the opening hours at a pub called The Crosse Keys?",
    "What are the opening hours at a pub named The Crosse Keys?",
    "What are the opening hours of Seething Lane Tap: A BrewDog Pub?",
    "What are the closing times for Tower Bridge Arms: A BrewDog Pub?",
    "What are Seething Lane Tap: A BrewDog Pub's opening hours?",
  ])("routes an explicit venue-hours question: %s", (query) => {
    expect(routeAskDeterministically(query)).toEqual([{ name: "search_venues", args: { query } }]);
  });

  it("keeps a complete pub name beside a transit request", () => {
    const query = "Are there Tube delays and what are the opening hours at Tower Bridge Arms: A BrewDog Pub?";
    expect(routeAskDeterministically(query)).toEqual([
      { name: "city_status", args: {} }, { name: "search_venues", args: { query } },
    ]);
  });

  it("preserves crawl planning with an hours preference", () => {
    const query = "Plan a crawl in Soho with late opening hours";
    expect(routeAskDeterministically(query)).toEqual([{ name: "propose_plan", args: { query } }]);
  });

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
    "Plan a pub crawl in Soho that fits the opening hours",
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

  it.each([
    "History of Mr. Fogg's Show the source and date for any price you use.",
    "Tell me the history of Mr. Fogg's Show the source and date for any price you use.",
  ])("preserves the unpunctuated heritage subject and original query: %s", (query) => {
    expect(routeAskDeterministically(query)).toEqual([
      { name: "venue_heritage", args: { query } },
    ]);
  });

  it.each([
    "What is the history of Mr. Fogg's?",
    "History of Mr. Fogg's.",
    "Tell me the history of Mr. Fogg's.",
  ].flatMap((request) => {
    const evidence = "Show the source and date for any price you use.";
    return [request, `${request} ${evidence}`, `${evidence} ${request}`];
  }))("preserves the actual heritage subject and original query: %s", (query) => {
    expect(routeAskDeterministically(query)).toEqual([
      { name: "venue_heritage", args: { query } },
    ]);
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

  it.each([
    ["somewhere quiet", ["quiet"], undefined],
    ["cheap", [], 6],
    ["somewhere cheap", [], 6],
    ["cheap and quiet", ["quiet"], 6],
  ] as const)("preserves discovery constraints when borrowing an area: %s", async (request, mood, maxPintPrice) => {
    const evidence = "Show the source and date for any price you use";
    for (const prior of ["pubs in Camden", `pubs in Camden and ${evidence}`]) {
      for (const query of [request, `${request}.`, `${request} and ${evidence}`, `${evidence}. ${request}`, `${evidence}. ${request} and ${evidence}. Include the map`]) {
        const refined = refineRoutedAskQuery(query, prior);
        expect(refined).toContain(query);
        expect(unsupportedPriceComparison(refined)).toBeNull();
        expect(routeAskDeterministically(refined)).toEqual([{ name: "search_venues", args: { query: refined, limit: 4 } }]);
        expect((await parseConciergeIntent(refined, { skipModel: true })).intent).toEqual({ area: "Camden", mood, maxPintPrice, groupSize: 2 });
      }
    }
  });

  it.each([
    ["quiet and cheap", "UNSUPPORTED_PRICE_COMPARISON"],
    ["cheap burgers", "UNSUPPORTED_FOOD_PRICE_COMPARISON"],
    ["cheap wine", "UNSUPPORTED_DRINK_PRICE_COMPARISON"],
  ])("preserves the existing price guard across area refinement: %s", (request, code) => {
    const evidence = "Show the source and date for any price you use";
    for (const query of [request, `${request} and ${evidence}`, `${evidence}. ${request} and ${evidence}`]) {
      const refined = refineRoutedAskQuery(query, "pubs in Camden");
      expect(refined).toContain(query);
      expect(unsupportedPriceComparison(refined)?.code).toBe(code);
      expect(routeAskDeterministically(refined)).toEqual([]);
    }
  });

  it.each([
    ["Find pubs in Camden", "somewhere quiet and please include sources and dates for every price you quote", "Camden", "quiet"],
    ["Find pubs in Camden and show the source and date for any price you use", "somewhere quiet", "Camden", "quiet"],
    ["Find pubs and show the source and date for any price you use", "somewhere quiet", undefined, "quiet"],
    ["Find pubs and show the source and date for any price you use", "somewhere quiet and please include sources and dates for every price you quote", undefined, "quiet"],
    ["Find pubs in Camden", "Show the source and date for any price you use; somewhere romantic", "Camden", "date"],
  ] as const)("preserves discovery across follow-up joins: %s / %s", async (prior, query, area, mood) => {
    const refined = refineRoutedAskQuery(query, prior);
    expect(refined).toContain(query);
    if (!area) expect(refined).toContain(prior);
    expect((await parseConciergeIntent(refined, { skipModel: true })).intent).toEqual({ area, mood: [mood], groupSize: 2 });
    expect(unsupportedPriceComparison(refined)).toBeNull();
    expect(routeAskDeterministically(refined)).toEqual([{ name: "search_venues", args: { query: refined, limit: 4 } }]);
  });

  it.each(["Same area, but under £6.50 a pint.", "In the same area but under £6.50 please"])("keeps a longer budget refinement in the discovered area: %s", (query) => {
    const refined = refineRoutedAskQuery(query, "Find me four pubs in Soho and show them on the map.");
    expect(refined).toContain("pubs in Soho");
    expect(routeAskDeterministically(refined).map((call) => call.name)).toEqual(["search_venues"]);
  });

  it.each(["Pint at The Lamb in the same area under £6.50", "Same area but cheapest wine under £6.50", "Pubs in Camden in the same area under £6.50"])("keeps a new named subject or place: %s", (query) => {
    expect(refineRoutedAskQuery(query, "Find four pubs in Soho")).toBe(query);
  });

  it("keeps the explicit area across successive budget refinements", () => {
    const prior = ["Find four pubs in Soho", "Same area, under £6.50 a pint"];
    const refined = refineRoutedAskQuery("Same area but under £6.30 a pint", prior.at(-1), prior);
    expect(refined).toContain("pubs in Soho");
    expect(routeAskDeterministically(refined).map((call) => call.name)).toEqual(["search_venues"]);
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
