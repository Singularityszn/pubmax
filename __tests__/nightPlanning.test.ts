import { describe, expect, it } from "vitest";

import { DESCRIBE_FIRST_CHIPS } from "@/components/plan/PlanDescribeFirst";
import { cleanNightContext, cleanNightContextPatch, inferNightContext } from "@/lib/nightPlanning";

/** Fixed London afternoon so default daypart cannot mask missing occasion words. */
const AFTERNOON = new Date("2026-08-07T13:00:00.000Z");
/** Fixed London evening so daytime chip language must win over the clock default. */
const EVENING = new Date("2026-08-07T19:30:00.000Z");

describe("inferNightContext", () => {
  it.each([
    ["cheap wine in Soho for 2", "wine"],
    ["cocktails in Soho for 2", "cocktail"],
    ["whisky in Soho for 2", "whisky"],
    ["cheap pints in Soho for 2", "beer"],
    ["drinks in Soho for 2", null],
    ["alcohol-free drinks in Soho for 2", null],
    ["cheap pints on Rye Lane in Peckham for four, under £24 each", "beer"],
    ["cheap pints in Peckham on Rye Lane under £30 each", "beer"],
    ["Start at the Rose and Crown, cheap pints in Clapham under £20 each", "beer"],
    ["pints near the Punch Bowl in Mayfair", "beer"],
    ["cheap pints in Soho, start at the Gin Palace", "beer"],
    ["drinks at the Gin Palace in Soho", null],
    ["cocktail menu for my mate while I am on pints", "beer"],
    ["no cocktails, just cheap pints in Soho", "beer"],
    ["pints and cocktails in Soho", null],
    ["cocktails in Soho somewhere with a beer garden", "cocktail"],
    ["Clapham pubs near The Wine Bar under £30 each", null],
    ["Clapham pubs near Gin and Juice under £30 each", null],
    ["I am drinking wine and my mate wants pints in Soho", "wine"],
    ["pints for my mate, I'm on the wine in Soho", "wine"],
    ["root beer in Soho under £30 each", "soft-drink"],
    ["a glass of red in Soho under £30 each", "wine"],
    ["cheap rosé in Soho under £12 each", "wine"],
    ["martinis in Soho", "gin"],
    ["espresso martinis in Soho", "vodka"],
    ["mojitos in Soho", "rum"],
    ["tequila in Shoreditch", "shot"],
    ["cheap cava in Soho", "wine"],
    ["porter and pilsner in Soho", "beer"],
    ["gin and tonic in Soho", "gin"],
    ["whisky sour in Soho", "whisky"],
    ["worth a shot, cheap pints in Soho", "beer"],
    ["I want a shot in Soho under £30 each", "shot"],
    ["In Soho I fancy wine under £30 each", "wine"],
    ["No gin or wine, cheap cocktails in Soho under £30 each", "cocktail"],
    ["no cocktails just cheap pints in Soho", "beer"],
    ["pubs in Soho serving wine under £30 each", "wine"],
    ["a night in Soho drinking cocktails under £30 each", "cocktail"],
    ["no frills or fuss wine night in Soho under £30 each", "wine"],
    ["pubs in Soho that do cocktails under £15 each", "cocktail"],
    ["somewhere in Shoreditch doing cocktails", "cocktail"],
    ["on a wine crawl in Soho under £30", "wine"],
    ["Soho on the wine under £30 each", "wine"],
    ["no beer or cider, wine in Soho", "wine"],
    ["no red or white wine, cocktails in Soho under £30", "cocktail"],
    ["no red or white wine, just cocktails in Soho under £30 each", "cocktail"],
    ["not beer or white wine, cocktails in Soho", "cocktail"],
    ["no lager or pale ale, cocktails in Soho under £30 each", "cocktail"],
    ["No gin or red wine, cheap pints in Soho under £30 each", "beer"],
    ["no coffee or ginger beer, wine night in Soho under £30 each", "wine"],
    ["no gin or gin and tonic, wine night in Soho under £30 each", "wine"],
    ["cheap cocktails on the Wine Bar terrace in Soho under £30 each", "cocktail"],
    ["pints on Cocktail Alley in Soho", "beer"],
    ["cheap pints on the Wine Bar terrace", "beer"],
    ["I'm on Guinness in Soho", "beer"],
    ["no bitter or lager, just cocktails in Soho under £30 each", "cocktail"],
    ["no bitter or lager, cocktails in Soho", "cocktail"],
    ["no port or wine, cocktails in Soho", "cocktail"],
    ["no port or wine in Soho under £30", null],
    ["no sours or cocktails, pints in Soho", "beer"],
    ["a night on the Prosecco in Soho under £30 each", "wine"],
    ["out on the Aperol in Soho under £30 each", "cocktail"],
    ["Soho on Aperol under £30 each", "cocktail"],
    ["on Saturday Negronis in Soho under £30 each", "gin"],
    ["Soho on cocktails then Covent Garden under £15 each", "cocktail"],
    ["a night on wine all the way under £30 each", "wine"],
    ["Soho on wine then Borough Market under £30", "wine"],
    ["on cocktails round Soho Square under £15 each", "cocktail"],
    ["on wine till the Crown and Anchor under £30 each", "wine"],
    ["on prosecco till the crown under £30", "wine"],
    ["out on wine down Brick Lane under £30 each", "wine"],
    ["on cocktails up Carnaby Street under £15 each", "cocktail"],
  ] as const)("retains the requested drink category in %s", (query, category) => {
    const { context } = inferNightContext(query, EVENING);
    expect(context.drinkCategory).toBe(category);
  });

  it("cleans a selected drink category without changing legacy contexts", () => {
    const legacy = inferNightContext("drinks in Soho", EVENING).context;
    const withoutCategory = { ...legacy };
    delete withoutCategory.drinkCategory;
    expect(cleanNightContext(withoutCategory)?.drinkCategory).toBeNull();
    expect(cleanNightContextPatch({ drinkCategory: "wine" })).toMatchObject({ drinkCategory: "wine" });
    expect(cleanNightContext({ ...legacy, drinkCategory: "not-a-drink" })?.drinkCategory).toBeNull();
  });

  it("turns a natural-language night into editable, explained context", () => {
    const result = inferNightContext("Four of us after work in Clapham, cheap, lively, kebab after");

    expect(result.context).toMatchObject({
      nightArea: "clapham",
      daypart: "after_work",
      partyType: "friends",
      groupSize: 4,
      budget: "value",
      atmosphere: ["lively"],
      foodNeeds: ["kebab"],
      wetherspoonsPreferred: false,
    });
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "nightArea", evidence: "Clapham" }),
      expect.objectContaining({ field: "groupSize", evidence: "Four" }),
    ]));
  });

  it("uses London time for an omitted daypart and never invents a Home Area", () => {
    const result = inferNightContext("A quiet solo night in Barnes", new Date("2026-07-13T13:00:00.000Z"));
    expect(result.context).toMatchObject({ nightArea: "barnes", daypart: "daytime", partyType: "solo", wetherspoonsPreferred: false });
    expect(result.context).not.toHaveProperty("homeArea");
  });

  it("keeps the small hours past midnight as late_night instead of the next day's daytime", () => {
    const result = inferNightContext("A quiet solo night in Barnes", new Date("2026-01-13T02:00:00.000Z"));
    expect(result.context.daypart).toBe("late_night");
  });

  it("treats 11pm London time as get_home, not daytime", () => {
    const result = inferNightContext("A quiet solo night in Barnes", new Date("2026-01-13T23:00:00.000Z"));
    expect(result.context.daypart).toBe("get_home");
  });

  it.each([
    ["Quiet in Clapham for 4, not pricey", 4],
    ["A party of five in Soho", 5],
    ["A group of 6 near Victoria", 6],
  ])("recognises compact group-size phrasing: %s", (query, groupSize) => {
    expect(inferNightContext(query).context.groupSize).toBe(groupSize);
  });

  it.each([
    ["crawl in Camden for 5", 3],
    ["a 6 pub crawl in Camden", 6],
    ["a big crawl in Camden", 6],
    ["five stops around Camden", 5],
  ])("keeps group phrasing separate from requested stop count: %s", (query, stopCount) => {
    expect(inferNightContext(query).context.stopCount).toBe(stopCount);
  });

  it("recognises reviewed expansion aliases without treating them as route-ready", () => {
    const result = inferNightContext("A quiet evening near Camden Town");
    expect(result.context.nightArea).toBe("camden");
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "nightArea", evidence: "Camden Town" }),
    ]));
  });

  it("captures an explicit per-person route budget without inventing one", () => {
    expect(inferNightContext("Clapham tonight, keep it under £24 each").context.budgetLimitPence).toBe(2400);
    expect(inferNightContext("Clapham tonight, standard budget").context.budgetLimitPence).toBeNull();
  });

  it("maps soft-drink language onto the zero-proof preference generate already ranks on", () => {
    expect(inferNightContext("soft drinks in Camden for 3", EVENING).context.zeroProof).toBe(true);
    expect(inferNightContext("a soft drink in Shoreditch", EVENING).context.zeroProof).toBe(true);
  });

  it.each([
    "No alcohol tonight",
    "no-alcohol in Soho",
    "NO ALCOHOL tonight, near the Wine Bar",
  ])("keeps the explicit alcohol-free request in %s", (query) => {
    expect(inferNightContext(query, EVENING).context).toMatchObject({
      zeroProof: true,
      drinkCategory: null,
    });
  });

  it.each([
    "Piano alcohol tasting in Soho",
    "No alcoholometers needed for wine in Soho",
  ])("requires complete no-alcohol tokens in %s", (query) => {
    expect(inferNightContext(query, EVENING).context.zeroProof).toBe(false);
  });

  it("maps coffee and catch-up language to daytime even against an evening clock", () => {
    expect(inferNightContext("coffee in Clapham for 2", EVENING).context.daypart).toBe("daytime");
    expect(inferNightContext("a catch-up in Clapham for 2", EVENING).context.daypart).toBe("daytime");
  });

  it("keeps an explicit tonight evening when coffee is also mentioned", () => {
    expect(inferNightContext("coffee tonight in Clapham", AFTERNOON).context.daypart).toBe("evening");
  });
});

describe("DESCRIBE_FIRST_CHIPS occasion parsing", () => {
  // Each chip label is a promise of parsed occasion fields, not only HTTP 200.
  // Generate has no Wetherspoons chain filter: the Spoons chip pins daytime +
  // value only. Residual gap: route stops are not forced onto the directory.

  it("covers every shipped describe-first chip", () => {
    expect(DESCRIBE_FIRST_CHIPS).toEqual([
      "Quiet in Clapham for 4, not pricey",
      "cheap pints tonight in Shoreditch",
      "alcohol-free drinks in Camden for 3",
      "quiet afternoon in Clapham for 2, soft drinks",
      "food then a soft drink in Shoreditch for 4",
      "coffee and a catch-up in Clapham for 2",
      "chill Wetherspoons in Clapham for 3",
    ]);
  });

  it.each([
    [
      "Quiet in Clapham for 4, not pricey",
      {
        nightArea: "clapham",
        groupSize: 4,
        budget: "value",
        atmosphere: ["quiet"],
        zeroProof: false,
      },
      EVENING,
    ],
    [
      "cheap pints tonight in Shoreditch",
      {
        nightArea: "shoreditch",
        daypart: "evening",
        budget: "value",
        zeroProof: false,
      },
      AFTERNOON,
    ],
    [
      "alcohol-free drinks in Camden for 3",
      {
        nightArea: "camden",
        groupSize: 3,
        zeroProof: true,
      },
      EVENING,
    ],
    [
      "quiet afternoon in Clapham for 2, soft drinks",
      {
        nightArea: "clapham",
        daypart: "daytime",
        groupSize: 2,
        atmosphere: ["quiet"],
        zeroProof: true,
      },
      EVENING,
    ],
    [
      "food then a soft drink in Shoreditch for 4",
      {
        nightArea: "shoreditch",
        groupSize: 4,
        foodNeeds: ["food"],
        zeroProof: true,
      },
      EVENING,
    ],
    [
      "coffee and a catch-up in Clapham for 2",
      {
        nightArea: "clapham",
        daypart: "daytime",
        groupSize: 2,
        zeroProof: false,
      },
      EVENING,
    ],
    [
      "chill Wetherspoons in Clapham for 3",
      {
        nightArea: "clapham",
        daypart: "daytime",
        groupSize: 3,
        budget: "value",
        atmosphere: ["quiet"],
        zeroProof: false,
      },
      EVENING,
    ],
  ] as const)("honours the occasion promised by %s", (chip, expected, now) => {
    expect(DESCRIBE_FIRST_CHIPS).toContain(chip);
    expect(inferNightContext(chip, now).context).toMatchObject(expected);
  });

  it.each([
    "chill Wetherspoons in Clapham for 3",
    "Spoons near Camden this afternoon",
    "a Wetherspoon lunch in Soho",
  ])("soft-prefers the first-party directory when free text names Spoons: %s", (query) => {
    const result = inferNightContext(query, new Date("2026-07-13T18:00:00.000Z"));
    expect(result.context.wetherspoonsPreferred).toBe(true);
    expect(result.context.budget).toBe("value");
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "wetherspoonsPreferred", evidence: "Wetherspoons" }),
    ]));
  });

  it("leaves wetherspoonsPreferred false when the chain is not named", () => {
    expect(inferNightContext("Quiet in Clapham for 4, not pricey").context.wetherspoonsPreferred).toBe(false);
  });

  it("defaults a Spoons outing to daytime when no clock word is stated", () => {
    const result = inferNightContext(
      "chill Wetherspoons in Clapham for 3",
      new Date("2026-07-13T18:00:00.000Z"),
    );
    expect(DESCRIBE_FIRST_CHIPS).toContain("chill Wetherspoons in Clapham for 3");
    expect(result.context).toMatchObject({
      nightArea: "clapham",
      daypart: "daytime",
      groupSize: 3,
      budget: "value",
      wetherspoonsPreferred: true,
    });
  });

  it("keeps an explicit evening clock word over the Spoons daytime default", () => {
    const result = inferNightContext(
      "Wetherspoons tonight in Clapham for 3",
      new Date("2026-07-13T12:00:00.000Z"),
    );
    expect(result.context).toMatchObject({
      daypart: "evening",
      budget: "value",
      wetherspoonsPreferred: true,
    });
  });
});
