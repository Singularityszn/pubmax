import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  EXTRACT_CREDIT_COST,
  SEARCH_CREDIT_COST,
  acceptedExtractUrls,
  advanceCursor,
  chooseOperatorUrl,
  factsFromPage,
  mergeQueue,
  openSpendLedger,
  parseNightlyArgs,
  queueDocument,
  readTavilyUsage,
  redactSecrets,
  reportedCredits,
  runNightlyPass,
  saveNightlyProgress,
  selectNightlyVenues,
  toNightlyVenue,
  tonightAllowance,
  venueKey,
} from "@/lib/harvest/tavilyNightlyPass";

const FIXTURES = path.join(__dirname, "fixtures", "tavily-nightly");
const searchFixture = JSON.parse(readFileSync(path.join(FIXTURES, "eastbrook-search.json"), "utf8"));
const extractFixture = JSON.parse(readFileSync(path.join(FIXTURES, "eastbrook-extract.json"), "utf8"));

const researcher = {
  key: { usage: 40, limit: 1000 },
  account: {
    current_plan: "Researcher",
    plan_usage: 40,
    plan_limit: 1000,
    paygo_usage: 0,
    paygo_limit: 100000,
  },
};

const oct1 = new Date("2026-10-01T12:00:00.000Z");

function venue(partial: Record<string, unknown>) {
  return {
    id: "venue-a",
    name: "The Example",
    postcode: "E1 1AA",
    street: "",
    borough: "Hackney",
    areaText: "",
    priced: false,
    ...partial,
  };
}

describe("tonight's Tavily allowance", () => {
  it("splits the credits left this month across the days still in the cycle, after a reserve", () => {
    const allowance = tonightAllowance({ usage: researcher, now: oct1, reserveCredits: 50 });
    expect(allowance.credits).toBe(29);
    expect(allowance.remaining).toBe(960);
    expect(allowance.daysLeft).toBe(31);
    expect(allowance.plan).toBe("Researcher");
  });

  it("does not treat pay-as-you-go headroom as monthly plan credit", () => {
    const allowance = tonightAllowance({ usage: researcher, now: oct1, reserveCredits: 50 });
    expect(allowance.credits).toBe(29);
  });

  it("gives the last day of the cycle everything still spendable", () => {
    const allowance = tonightAllowance({
      usage: researcher,
      now: new Date("2026-10-31T23:00:00.000Z"),
      reserveCredits: 50,
    });
    expect(allowance.daysLeft).toBe(1);
    expect(allowance.credits).toBe(910);
  });

  it("returns zero when the reserve covers what the plan has left", () => {
    const allowance = tonightAllowance({
      usage: {
        key: { usage: 980, limit: 1000 },
        account: { current_plan: "Researcher", plan_usage: 980, plan_limit: 1000 },
      },
      now: oct1,
      reserveCredits: 50,
    });
    expect(allowance.credits).toBe(0);
    expect(allowance.remaining).toBe(20);
  });

  it("binds the night to the tighter of the key limit and the plan limit", () => {
    const allowance = tonightAllowance({
      usage: {
        key: { usage: 90, limit: 100 },
        account: { current_plan: "Researcher", plan_usage: 40, plan_limit: 1000 },
      },
      now: new Date("2026-10-31T00:00:00.000Z"),
      reserveCredits: 0,
    });
    expect(allowance.remaining).toBe(10);
    expect(allowance.credits).toBe(10);
  });

  it("lets a manual cap lower the night and never raise it", () => {
    expect(tonightAllowance({ usage: researcher, now: oct1, reserveCredits: 50, manualCap: 5 }).credits).toBe(5);
    expect(tonightAllowance({ usage: researcher, now: oct1, reserveCredits: 50, manualCap: 10_000 }).credits).toBe(29);
    expect(tonightAllowance({ usage: researcher, now: oct1, reserveCredits: 50, manualCap: 0 }).credits).toBe(0);
  });

  it("fails closed when the usage payload has no limit", () => {
    const allowance = tonightAllowance({
      usage: { key: { usage: 1 }, account: { current_plan: "Researcher", plan_usage: 1 } },
      now: oct1,
    });
    expect(allowance.credits).toBe(0);
    expect(allowance.reason).toBe("no-plan-limit");
  });

  it("reads the documented usage payload and ignores a missing plan name", () => {
    expect(readTavilyUsage(researcher)?.account.plan_limit).toBe(1000);
    expect(readTavilyUsage({ key: { usage: "nope" } })).toBeNull();
  });
});

describe("hard stop", () => {
  it("refuses another call once the allowance is spent, and counts an in-flight overshoot", () => {
    const ledger = openSpendLedger(2);
    expect(ledger.canSpend(SEARCH_CREDIT_COST)).toBe(true);
    ledger.record(2);
    expect(ledger.spent).toBe(2);
    expect(ledger.canSpend(1)).toBe(false);
    expect(ledger.exhausted).toBe(true);
  });

  it("counts a recorded response's credits and falls back high when the body omits them", () => {
    expect(reportedCredits(searchFixture, SEARCH_CREDIT_COST)).toBe(1);
    expect(reportedCredits({}, EXTRACT_CREDIT_COST)).toBe(EXTRACT_CREDIT_COST);
    expect(reportedCredits({ usage: { credits: -3 } }, 1)).toBe(1);
  });
});

describe("cursor resume", () => {
  const pool = [
    venue({ id: "seen", name: "Seen", postcode: "E1 1AA" }),
    venue({ id: "fresh", name: "Fresh", postcode: "E2 2BB" }),
  ];

  it("skips a venue already seen today and continues with the next one", () => {
    const cursor = advanceCursor({ version: 1, lastSeen: {} }, ["seen"], "2026-10-01");
    const next = selectNightlyVenues(pool, cursor, { today: "2026-10-01", staleAfterDays: 30, limit: 10 });
    expect(next.map((row) => row.id)).toEqual(["fresh"]);
  });

  it("is idempotent when the same venue is recorded twice on the same day", () => {
    const once = advanceCursor({ version: 1, lastSeen: { other: "2026-09-01" } }, ["seen"], "2026-10-01");
    const twice = advanceCursor(once, ["seen"], "2026-10-01");
    expect(twice).toEqual(once);
    expect(twice.lastSeen.other).toBe("2026-09-01");
  });

  it("revisits a venue once its last-seen date is at least N days old", () => {
    const cursor = { version: 1 as const, lastSeen: { seen: "2026-09-01", fresh: "2026-09-20" } };
    const due = selectNightlyVenues(pool, cursor, { today: "2026-10-01", staleAfterDays: 30, limit: 10 });
    expect(due.map((row) => row.id)).toEqual(["seen"]);
  });

  it("does not revisit a venue on the same calendar day even when the stale window is zero", () => {
    const cursor = advanceCursor({ version: 1, lastSeen: {} }, ["seen"], "2026-10-01");
    const next = selectNightlyVenues(pool, cursor, { today: "2026-10-01", staleAfterDays: 0, limit: 10 });
    expect(next.map((row) => row.id)).not.toContain("seen");
  });
});

describe("priority", () => {
  it("takes unpriced venues first, seed patches then thin boroughs, then the oldest evidence", () => {
    const pool = [
      venue({ id: "priced-old", name: "Old", priced: true, borough: "Hackney", evidenceHint: "2020-01-01" }),
      venue({ id: "unpriced-rest", name: "Rest", borough: "Hackney", postcode: "E8 1AA" }),
      venue({
        id: "unpriced-seed",
        name: "French House",
        borough: "Westminster",
        areaText: "soho greek street",
        postcode: "W1D 5DH",
      }),
      venue({
        id: "unpriced-thin",
        name: "Eastbrook",
        borough: "Barking and Dagenham",
        postcode: "IG11 7AB",
      }),
      venue({
        id: "unpriced-seed-unseen",
        name: "Camden Arms",
        borough: "Camden",
        postcode: "NW1 1AA",
      }),
    ];
    const cursor = {
      version: 1 as const,
      lastSeen: { "unpriced-seed": "2025-06-01", "priced-old": "2020-01-01" },
    };
    const order = selectNightlyVenues(pool, cursor, {
      today: "2026-10-01",
      staleAfterDays: 0,
      limit: 10,
    }).map((row) => row.id);
    expect(order).toEqual([
      "unpriced-seed-unseen",
      "unpriced-seed",
      "unpriced-thin",
      "unpriced-rest",
      "priced-old",
    ]);
  });

  it("keeps two pubs that share a name apart by postcode", () => {
    const islington = venue({ id: "albion-n1", name: "The Albion", postcode: "N1 1AA", borough: "Islington" });
    const kingston = venue({
      id: "albion-kt1",
      name: "The Albion",
      postcode: "KT1 1JT",
      borough: "Kingston upon Thames",
    });
    expect(venueKey(islington)).not.toBe(venueKey(kingston));
    const queued = mergeQueue(
      { version: 1, standingRule: "listed", venues: [] },
      [
        {
          venueId: islington.id,
          name: islington.name,
          postcode: islington.postcode,
          borough: islington.borough,
          seenOn: "2026-10-01",
          website: null,
          drinks: [],
          food: { served: null, priceMinGbp: null, priceMaxGbp: null, dishes: [], sourceUrl: null, seenOn: null },
          amenities: [],
          hours: null,
          phone: null,
          closure: null,
          candidates: [],
        },
        {
          venueId: kingston.id,
          name: kingston.name,
          postcode: kingston.postcode,
          borough: kingston.borough,
          seenOn: "2026-10-01",
          website: null,
          drinks: [],
          food: { served: null, priceMinGbp: null, priceMaxGbp: null, dishes: [], sourceUrl: null, seenOn: null },
          amenities: [],
          hours: null,
          phone: null,
          closure: null,
          candidates: [],
        },
      ],
    );
    expect(queued.venues).toHaveLength(2);
    expect(queued.venues.map((row) => row.postcode).sort()).toEqual(["KT1 1JT", "N1 1AA"]);
  });
});

describe("price lines from a recorded page", () => {
  const page = extractFixture.results[0].raw_content as string;
  const sourceUrl = "https://eastbrookpub.co.uk/drink-menu.html";

  it("keeps a stated pint, a keg line, and a bottle, and does not call a keg a pint", () => {
    const facts = factsFromPage(page, { sourceUrl, seenOn: "2026-10-01" });
    const byDrink = Object.fromEntries(facts.drinks.map((row) => [row.drink, row]));
    expect(byDrink["London Pride"]).toMatchObject({ size: "pint", priceGbp: 5.5, standing: "listed", sourceUrl, seenOn: "2026-10-01" });
    expect(byDrink["Somerset Cider"]).toMatchObject({ size: "pint", priceGbp: 4.8, standing: "listed" });
    expect(byDrink["Asahi Super Dry Draught Lager"]).toMatchObject({ size: "keg", priceGbp: 6.7, standing: "listed" });
    expect(byDrink["Madri Lager"]).toMatchObject({ size: "unstated", priceGbp: 7, standing: "listed" });
    expect(byDrink["Peroni Nastro Azzurro"]).toMatchObject({ size: "bottle", priceGbp: 6.55, sizeDetail: "330ml", standing: "listed" });
    expect(facts.drinks.find((row) => row.priceGbp === 3.55)).toBeUndefined();
    expect(facts.drinks.find((row) => row.priceGbp === 6)).toBeUndefined();
    expect(facts.drinks.find((row) => row.priceGbp === 50)).toBeUndefined();
    expect(facts.drinks.find((row) => /fiver|about/i.test(row.drink))).toBeUndefined();
    expect(facts.drinks.every((row) => row.standing === "listed")).toBe(true);
  });

  it("reads food as served, with a stated range and named dishes, and reads the other facts off the same page", () => {
    const drinks = factsFromPage(page, { sourceUrl, seenOn: "2026-10-01" });
    const foodPage = factsFromPage(extractFixture.results[1].raw_content, {
      sourceUrl: "https://eastbrookpub.co.uk/food-menu.pdf",
      seenOn: "2026-10-01",
    });
    expect(foodPage.food.served).toBe(true);
    expect(foodPage.food.priceMinGbp).toBe(12);
    expect(foodPage.food.priceMaxGbp).toBe(14.5);
    expect(foodPage.food.dishes.map((dish) => dish.name).sort()).toEqual(["Burger", "Fish and chips"]);
    expect(foodPage.food.dishes[0]).toMatchObject({ sourceUrl: "https://eastbrookpub.co.uk/food-menu.pdf", seenOn: "2026-10-01" });
    expect(drinks.amenities.map((row) => row.kind).sort()).toEqual(["beer-garden", "live-sport", "music", "quiz"]);
    expect(drinks.amenities.find((row) => row.kind === "beer-garden")?.quote).toMatch(/Beer garden/);
    expect(drinks.hours?.statedDays).toContain("Monday");
    expect(drinks.phone?.value).toBe("020 7946 0991");
    expect(drinks.closure?.quote).toMatch(/permanently closed/i);
    expect(drinks.amenities.every((row) => row.sourceUrl === sourceUrl && row.seenOn === "2026-10-01")).toBe(true);
  });

  it("does not invent a food range from a page that never prices a dish", () => {
    const facts = factsFromPage("We serve food.\nMonday 12pm to 11pm", {
      sourceUrl: "https://example.test/about",
      seenOn: "2026-10-01",
    });
    expect(facts.food.served).toBe(true);
    expect(facts.food.priceMinGbp).toBeNull();
    expect(facts.food.dishes).toEqual([]);
  });

  it("reads an explicit no-food line as not served", () => {
    const facts = factsFromPage("We do not serve food.", {
      sourceUrl: "https://example.test/about",
      seenOn: "2026-10-01",
    });
    expect(facts.food.served).toBe(false);
  });
});

describe("recorded Tavily search", () => {
  const eastbrook = venue({
    id: "venue-cn9acj",
    name: "The Eastbrook",
    postcode: "IG11 7AB",
    borough: "Barking and Dagenham",
  });

  it("picks the pub's own host that states the postcode, and drops directories, refused estates, and private addresses", () => {
    const chosen = chooseOperatorUrl(searchFixture.results, eastbrook);
    expect(chosen).toBe("https://eastbrookpub.co.uk/drink-menu.html");
    const urls = acceptedExtractUrls(
      searchFixture.results.map((row: { url: string }) => row.url),
      "https://eastbrookpub.co.uk",
    );
    expect(urls).toEqual([
      "https://eastbrookpub.co.uk/drink-menu.html",
      "https://eastbrookpub.co.uk/food-menu.pdf",
    ]);
    expect(urls.join(" ")).not.toMatch(/tripadvisor|nicholsonspubs|169\.254/);
  });
});

describe("never Confirmed", () => {
  it("writes a queue whose prices are listed and that carries no community price", () => {
    const facts = factsFromPage("London Pride £5.50 /pint", {
      sourceUrl: "https://eastbrookpub.co.uk/drink-menu.html",
      seenOn: "2026-10-01",
    });
    const doc = queueDocument({
      version: 1,
      venues: [
        {
          venueId: "venue-cn9acj",
          name: "The Eastbrook",
          postcode: "IG11 7AB",
          borough: "Barking and Dagenham",
          seenOn: "2026-10-01",
          website: null,
          drinks: facts.drinks,
          food: facts.food,
          amenities: [],
          hours: null,
          phone: null,
          closure: null,
          candidates: [],
        },
      ],
    });
    expect(doc.standingRule).toBe("listed");
    expect(doc.venues[0].drinks[0].standing).toBe("listed");
    const encoded = JSON.stringify(doc);
    expect(encoded).not.toContain("confirmed");
    expect(encoded).not.toContain("cheapestPrice");
    expect(encoded).not.toContain("contributor");
  });

  it("rejects a row that tries to set standing confirmed or a community price", () => {
    expect(() =>
      queueDocument({
        version: 1,
        venues: [
          {
            venueId: "venue-cn9acj",
            name: "The Eastbrook",
            postcode: "IG11 7AB",
            borough: "Barking and Dagenham",
            seenOn: "2026-10-01",
            cheapestPrice: 5.5,
            drinks: [
              {
                drink: "London Pride",
                size: "pint",
                sizeDetail: "pint",
                priceGbp: 5.5,
                standing: "confirmed",
                sourceUrl: "https://eastbrookpub.co.uk/drink-menu.html",
                seenOn: "2026-10-01",
              },
            ],
            food: { served: null, priceMinGbp: null, priceMaxGbp: null, dishes: [], sourceUrl: null, seenOn: null },
            amenities: [],
            hours: null,
            phone: null,
            closure: null,
            candidates: [],
          },
        ],
      }),
    ).toThrow(/listed/i);
  });
});

describe("a night against recorded responses", () => {
  it("spends within the cap, writes listed evidence, and resumes on the next venue", async () => {
    const eastbrook = venue({
      id: "venue-cn9acj",
      name: "The Eastbrook",
      postcode: "IG11 7AB",
      borough: "Barking and Dagenham",
    });
    const other = venue({ id: "venue-next", name: "The Next", postcode: "E8 1JH", borough: "Hackney" });
    const calls: string[] = [];
    const fetchImpl = async (request: { kind: string }) => {
      calls.push(request.kind);
      if (request.kind === "search") return searchFixture;
      return extractFixture;
    };
    const first = await runNightlyPass({
      venues: [eastbrook, other],
      cursor: { version: 1, lastSeen: {} },
      usage: researcher,
      now: oct1,
      reserveCredits: 50,
      manualCap: 2,
      staleAfterDays: 30,
      fetchImpl,
      queue: { version: 1, standingRule: "listed", venues: [] },
    });
    expect(first.spent).toBe(2);
    expect(first.stopped).toBe("allowance");
    expect(calls).toEqual(["search", "extract"]);
    expect(first.cursor.lastSeen["venue-cn9acj"]).toBe("2026-10-01");
    expect(first.cursor.lastSeen["venue-next"]).toBeUndefined();
    expect(first.queue.venues).toHaveLength(1);
    expect(first.queue.venues[0].drinks.every((row) => row.standing === "listed")).toBe(true);
    expect(JSON.stringify(first.queue)).not.toContain("confirmed");

    const second = await runNightlyPass({
      venues: [eastbrook, other],
      cursor: first.cursor,
      usage: researcher,
      now: oct1,
      reserveCredits: 50,
      manualCap: 2,
      staleAfterDays: 30,
      fetchImpl,
      queue: first.queue,
    });
    expect(second.cursor.lastSeen["venue-cn9acj"]).toBe("2026-10-01");
    expect(second.queue.venues.map((row) => row.venueId)).toContain("venue-next");
    expect(second.queue.venues.filter((row) => row.venueId === "venue-cn9acj")).toHaveLength(1);
  });
});

describe("arguments and redaction", () => {
  it("reads the manual cap and refuses a negative one", () => {
    expect(parseNightlyArgs(["--dry-run", "--max-credits=5", "--reserve=10", "--stale-days=14"])).toMatchObject({
      dryRun: true,
      manualCap: 5,
      reserveCredits: 10,
      staleAfterDays: 14,
    });
    expect(() => parseNightlyArgs(["--max-credits=-1"])).toThrow(/max-credits/);
  });

  it("strips the key out of anything that would be logged", () => {
    const secret = "tvly-test-key-value";
    expect(redactSecrets(`authorization Bearer ${secret} failed`, secret)).toBe("authorization Bearer [redacted] failed");
    expect(redactSecrets("no key here", secret)).toBe("no key here");
  });

  it("maps a slim venue row onto a nightly candidate and keeps its postcode", () => {
    const row = toNightlyVenue({
      id: "venue-xjf3n0",
      name: "Arnos Arms",
      borough: "Enfield",
      cheapestPrice: 5.5,
      filterHints: { searchText: "arnos arms 338 bowes road, arnos grove, london, n11 1an enfield" },
    });
    expect(row).toMatchObject({
      id: "venue-xjf3n0",
      postcode: "N11 1AN",
      borough: "Enfield",
      priced: true,
      street: "338 bowes road",
    });
  });

  it("keeps a house number with its road and drops a bare number range", () => {
    expect(toNightlyVenue({
      id: "lion",
      name: "The Black Lion",
      borough: "Newham",
      filterHints: { searchText: "the black lion 59-61, high street, london, e13 0ad newham" },
    })?.street).toBe("59 61 high street");
    expect(toNightlyVenue({
      id: "nelson",
      name: "The Lord Nelson",
      borough: "Hounslow",
      filterHints: { searchText: "the lord nelson 9-11 enfield road, brentford, tw8 0aa hounslow" },
    })?.street).toBe("9 11 enfield road");
    expect(toNightlyVenue({
      id: "ebb",
      name: "Ebb & Flow",
      borough: "Sutton",
      filterHints: { searchText: "ebb & flow 59-61, sm1 1dt sutton" },
    })?.street).toBe("");
  });
});

const listedQueue = { version: 1 as const, standingRule: "listed" as const, venues: [] };
const pageFact = { sourceUrl: "https://eastbrookpub.co.uk/drink-menu.html", seenOn: "2026-10-01" };

describe("a price stays in the lane the reader gave it", () => {
  it("keeps a soft drink, a wine and a cocktail, and still drops a beer outside the beer band", () => {
    const facts = factsFromPage(
      "Coca-Cola £1.50\nHouse Merlot 175ml £14.50\nEspresso Martini £13.00\nNameless 330ml £1.50\nPeroni 330ml £6.55",
      pageFact,
    );
    const prices = Object.fromEntries(facts.drinks.map((row) => [row.drink, row.priceGbp]));
    expect(prices["Coca-Cola"]).toBe(1.5);
    expect(prices["House Merlot"]).toBe(14.5);
    expect(prices["Espresso Martini"]).toBe(13);
    expect(prices["Peroni"]).toBe(6.55);
    expect(facts.drinks.find((row) => row.drink === "Nameless")).toBeUndefined();
  });

  it("records a stated dish and refuses an offer, a half and a price outside its drink band", () => {
    const facts = factsFromPage(
      "Burger from £12.00\nBurger. Peroni Half £3.55\nBurger. House wine £40.00\nFish and chips £14.50\nBurger £12.00",
      pageFact,
    );
    expect(facts.food.dishes.map((dish) => `${dish.name}|${dish.priceGbp}`).sort()).toEqual([
      "Burger|12",
      "Fish and chips|14.5",
    ]);
    expect(facts.drinks.find((row) => row.priceGbp === 3.55)).toBeUndefined();
  });

  it("queues a permanent closure and leaves an open kitchen and a former name alone", () => {
    const open = factsFromPage("The kitchen is now closed.\nFormerly known as The Red Lion.\nLondon Pride £5.50 /pint", pageFact);
    expect(open.closure).toBeNull();
    expect(open.drinks.map((row) => row.drink)).toContain("London Pride");
    const shut = factsFromPage("This pub is permanently closed.\nThe bar is closed for good.", pageFact);
    expect(shut.closure?.quote).toMatch(/permanently closed/i);
  });
});

describe("two pubs named The Crown", () => {
  const bankside = venue({
    id: "crown-se1",
    name: "The Crown",
    postcode: "SE1 6AN",
    street: "1 Bankside",
    borough: "Southwark",
  });
  const cable = venue({
    id: "crown-e1",
    name: "The Crown",
    postcode: "E1 6AN",
    street: "2 Cable Street",
    borough: "Tower Hamlets",
  });
  const results = [
    {
      url: "https://thecrown-cable.co.uk/drinks",
      title: "The Crown",
      content: "The Crown, 2 Cable Street, E1 6AN. London Pride £5.20 /pint.",
    },
    {
      url: "https://thecrown-bankside.co.uk/drinks",
      title: "The Crown",
      content: "The Crown, 1 Bankside, SE1 6AN. London Pride £6.10 /pint.",
    },
  ];

  it("binds each Crown to the page that states its own postcode or street", () => {
    expect(chooseOperatorUrl(results, bankside)).toBe("https://thecrown-bankside.co.uk/drinks");
    expect(chooseOperatorUrl(results, cable)).toBe("https://thecrown-cable.co.uk/drinks");
    expect(chooseOperatorUrl([
      { url: "https://thecrown-bankside.co.uk/drinks", title: "The Crown", content: "1 Bankside. London Pride £6.10 /pint." },
    ], bankside)).toBe("https://thecrown-bankside.co.uk/drinks");
    expect(chooseOperatorUrl(results.slice(0, 1), bankside)).toBeNull();
  });

  it("does not treat a shorter postcode or an opening time as this pub", () => {
    const se1 = [{ url: "https://thecrown-bankside.co.uk/drinks", title: "The Crown", content: "SE1 6AN. Open 11am." }];
    expect(chooseOperatorUrl(se1, cable)).toBeNull();
    expect(chooseOperatorUrl(se1, bankside)).toBe("https://thecrown-bankside.co.uk/drinks");
    expect(chooseOperatorUrl([
      { url: "https://thecrown.co.uk/drinks", title: "The Crown", content: "Open 11am. London Pride £5.50 /pint." },
    ], venue({ name: "The Crown", postcode: "N1 1AM", street: "4 Upper Street" }))).toBeNull();
    expect(chooseOperatorUrl([
      { url: "https://thecrown.co.uk/drinks", title: "The Crown", content: "SW1F 9BP" },
    ], venue({ name: "The Crown", postcode: "W1F 9BP", street: "5 Wardour Street" }))).toBeNull();
  });

  it("does not spend an extract or queue the other Crown when no result states this pub", async () => {
    const calls: string[] = [];
    const result = await runNightlyPass({
      venues: [bankside],
      cursor: { version: 1, lastSeen: {} },
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 10,
      staleAfterDays: 30,
      queue: listedQueue,
      fetchImpl: async (request) => {
        calls.push(request.kind);
        return {
          results: [{ url: "https://thecrown.co.uk/drinks", title: "The Crown", content: "London Pride £5.50 /pint. Open 11am." }],
          usage: { credits: 1 },
        };
      },
    });
    expect(calls).toEqual(["search"]);
    expect(result.queue.venues[0]).toMatchObject({
      venueId: "crown-se1",
      website: null,
      candidates: ["https://thecrown.co.uk/drinks"],
      drinks: [],
    });
  });

  it("queues each Crown's own pint when both pages come back", async () => {
    const result = await runNightlyPass({
      venues: [bankside, cable],
      cursor: { version: 1, lastSeen: {} },
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 10,
      staleAfterDays: 30,
      queue: listedQueue,
      fetchImpl: async (request) => {
        if (request.kind === "search") return { results, usage: { credits: 1 } };
        const pages = request.urls.map((url: string) => ({
          url,
          raw_content: url.includes("bankside")
            ? "The Crown, 1 Bankside, SE1 6AN\nLondon Pride £6.10 /pint"
            : "The Crown, 2 Cable Street, E1 6AN\nLondon Pride £5.20 /pint",
        }));
        return { results: pages, usage: { credits: 1 } };
      },
    });
    const byId = Object.fromEntries(result.queue.venues.map((row) => [row.venueId, row]));
    expect(byId["crown-se1"].website?.url).toBe("https://thecrown-bankside.co.uk/drinks");
    expect(byId["crown-se1"].drinks.map((row) => row.priceGbp)).toEqual([6.1]);
    expect(byId["crown-e1"].website?.url).toBe("https://thecrown-cable.co.uk/drinks");
    expect(byId["crown-e1"].drinks.map((row) => row.priceGbp)).toEqual([5.2]);
  });
});

describe("a street is a road name", () => {
  const nelson = venue({
    id: "nelson-tw8",
    name: "The Lord Nelson",
    postcode: "TW8 0AA",
    street: "9 11",
    borough: "Hounslow",
  });
  const hit = {
    url: "https://lordnelsonpub.co.uk/menu",
    title: "The Lord Nelson",
    content: "12 High Street, SE1 1AA. Pie £9.11",
  };

  it("does not bind a bare number range or a page that states another postcode", () => {
    expect(chooseOperatorUrl([hit], nelson)).toBeNull();
    expect(chooseOperatorUrl([hit], { ...nelson, street: "9 11 Enfield Road" })).toBeNull();
    expect(chooseOperatorUrl([{
      url: "https://lordnelsonpub.co.uk/menu",
      title: "The Lord Nelson",
      content: "9-11 Enfield Road, SE1 1AA. Pie £9.50",
    }], { ...nelson, street: "9 11 Enfield Road" })).toBeNull();
    expect(chooseOperatorUrl([{
      url: "https://lordnelsonpub.co.uk/menu",
      title: "The Lord Nelson",
      content: "9-11 Enfield Road. Pie £9.50",
    }], { ...nelson, street: "9 11 Enfield Road" })).toBe("https://lordnelsonpub.co.uk/menu");
  });
});

describe("a night that fails part way", () => {
  it("extracts a same-site menu listed without a snippet", async () => {
    const pub = venue({ id: "east", name: "The Eastbrook", postcode: "IG11 7AB", street: "1 Dagenham Road" });
    const extracted: string[][] = [];
    const result = await runNightlyPass({
      venues: [pub],
      cursor: { version: 1, lastSeen: {} },
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 10,
      staleAfterDays: 30,
      queue: listedQueue,
      fetchImpl: async (request) => {
        if (request.kind === "search") {
          return {
            results: [
              { url: "https://eastbrookpub.co.uk/food-menu.pdf", title: "Food", content: "" },
              {
                url: "https://eastbrookpub.co.uk/drink-menu.html",
                title: "The Eastbrook",
                content: "The Eastbrook, IG11 7AB. London Pride £5.50 /pint.",
              },
            ],
            usage: { credits: 1 },
          };
        }
        extracted.push(request.urls);
        return {
          results: [
            { url: "https://eastbrookpub.co.uk/food-menu.pdf", raw_content: "Burger £12.00" },
            { url: "https://eastbrookpub.co.uk/drink-menu.html", raw_content: "London Pride £5.50 /pint" },
          ],
          usage: { credits: 1 },
        };
      },
    });
    expect(extracted).toEqual([[
      "https://eastbrookpub.co.uk/food-menu.pdf",
      "https://eastbrookpub.co.uk/drink-menu.html",
    ]]);
    expect(result.queue.venues[0].food.dishes.map((dish) => dish.name)).toContain("Burger");
    expect(result.queue.venues[0].drinks.map((row) => row.drink)).toContain("London Pride");
  });

  it("keeps the previous pint and dish when a later read finds nothing", async () => {
    const pub = venue({
      id: "crown-se1",
      name: "The Crown",
      postcode: "SE1 6AN",
      street: "1 Bankside",
    });
    const search = {
      results: [{
        url: "https://thecrown-bankside.co.uk/drinks",
        title: "The Crown",
        content: "The Crown, 1 Bankside, SE1 6AN. London Pride £5.50 /pint. Burger £12.00",
      }],
      usage: { credits: 1 },
    };
    const first = await runNightlyPass({
      venues: [pub],
      cursor: { version: 1, lastSeen: {} },
      usage: researcher,
      now: new Date("2026-09-01T12:00:00.000Z"),
      reserveCredits: 0,
      manualCap: 10,
      staleAfterDays: 30,
      queue: listedQueue,
      fetchImpl: async (request) => {
        if (request.kind === "search") return search;
        return {
          results: [{
            url: "https://thecrown-bankside.co.uk/drinks",
            raw_content: "London Pride £5.50 /pint\nBurger £12.00",
          }],
          usage: { credits: 1 },
        };
      },
    });
    expect(first.queue.venues[0].drinks.map((row) => row.priceGbp)).toEqual([5.5]);
    expect(first.queue.venues[0].food.dishes.map((dish) => dish.priceGbp)).toEqual([12]);
    const later = await runNightlyPass({
      venues: [pub],
      cursor: first.cursor,
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 10,
      staleAfterDays: 30,
      queue: first.queue,
      fetchImpl: async () => ({ results: [], usage: { credits: 1 } }),
    });
    expect(later.cursor.lastSeen["crown-se1"]).toBe("2026-10-01");
    expect(later.queue.venues).toHaveLength(1);
    expect(later.queue.venues[0].drinks.map((row) => row.priceGbp)).toEqual([5.5]);
    expect(later.queue.venues[0].food.dishes.map((dish) => dish.priceGbp)).toEqual([12]);
    expect(later.queue.venues[0].website?.url).toBe("https://thecrown-bankside.co.uk/drinks");
  });

  it("keeps a queued dish when a later page states the kitchen but prices no dish", async () => {
    const pub = venue({
      id: "crown-se1",
      name: "The Crown",
      postcode: "SE1 6AN",
      street: "1 Bankside",
    });
    const site = "https://thecrown-bankside.co.uk/drinks";
    type Night = Awaited<ReturnType<typeof runNightlyPass>>;
    const night = (now: Date, queue: Night["queue"], cursor: Night["cursor"], body: string) =>
      runNightlyPass({
        venues: [pub],
        cursor,
        queue,
        now,
        usage: researcher,
        reserveCredits: 0,
        manualCap: 10,
        staleAfterDays: 30,
        fetchImpl: async (request) => {
          if (request.kind === "search") {
            return {
              results: [{ url: site, title: "The Crown", content: "The Crown, 1 Bankside, SE1 6AN." }],
              usage: { credits: 1 },
            };
          }
          return { results: [{ url: site, raw_content: body }], usage: { credits: 1 } };
        },
      });
    const first = await night(
      new Date("2026-09-01T12:00:00.000Z"),
      listedQueue,
      { version: 1, lastSeen: {} },
      "Burger £12.00",
    );
    expect(first.queue.venues[0].food.dishes.map((dish) => dish.name)).toEqual(["Burger"]);
    const kitchen = await night(oct1, first.queue, first.cursor, "Our kitchen\nLondon Pride £5.50 /pint");
    expect(kitchen.queue.venues[0].drinks.map((row) => row.drink)).toEqual(["London Pride"]);
    expect(kitchen.queue.venues[0].food.dishes.map((dish) => dish.name)).toEqual(["Burger"]);
    const closed = await night(
      new Date("2026-10-31T12:00:00.000Z"),
      kitchen.queue,
      kitchen.cursor,
      "The kitchen closed tonight.\nGuinness £5.80 /pint",
    );
    expect(closed.queue.venues[0].drinks.map((row) => row.drink)).toEqual(["Guinness"]);
    expect(closed.queue.venues[0].food.dishes.map((dish) => dish.name)).toEqual(["Burger"]);
    const replaced = await night(
      new Date("2026-11-30T12:00:00.000Z"),
      closed.queue,
      closed.cursor,
      "Pie £9.00",
    );
    expect(replaced.queue.venues[0].food.dishes.map((dish) => `${dish.name}|${dish.priceGbp}`)).toEqual(["Pie|9"]);
  });

  it("keeps curator urls when a later search returns nothing", async () => {
    const pub = venue({
      id: "crown-se1",
      name: "The Crown",
      postcode: "SE1 6AN",
      street: "1 Bankside",
    });
    const first = await runNightlyPass({
      venues: [pub],
      cursor: { version: 1, lastSeen: {} },
      usage: researcher,
      now: new Date("2026-09-01T12:00:00.000Z"),
      reserveCredits: 0,
      manualCap: 10,
      staleAfterDays: 30,
      queue: listedQueue,
      fetchImpl: async () => ({
        results: [{ url: "https://thecrown.co.uk/drinks", title: "The Crown", content: "London Pride £5.50 /pint. Open 11am." }],
        usage: { credits: 1 },
      }),
    });
    expect(first.queue.venues[0].website).toBeNull();
    expect(first.queue.venues[0].candidates).toEqual(["https://thecrown.co.uk/drinks"]);
    const later = await runNightlyPass({
      venues: [pub],
      cursor: first.cursor,
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 10,
      staleAfterDays: 30,
      queue: first.queue,
      fetchImpl: async () => ({ results: [], usage: { credits: 1 } }),
    });
    expect(later.queue.venues[0].website).toBeNull();
    expect(later.queue.venues[0].candidates).toEqual(["https://thecrown.co.uk/drinks"]);
  });

  it("saves a finished venue and carries on when a later call fails", async () => {
    const saved: string[][] = [];
    const seen: string[] = [];
    const result = await runNightlyPass({
      venues: [
        venue({ id: "a-ok", name: "The Eastbrook", postcode: "IG11 7AB", street: "1 Dagenham Road" }),
        venue({ id: "b-search", name: "The Crown", postcode: "SE1 6AN", street: "1 Bankside" }),
        venue({ id: "c-extract", name: "The Albion", postcode: "N1 1AA", street: "10 Upper Street" }),
        venue({ id: "d-ok", name: "The Hope", postcode: "E8 1JH", street: "3 Mare Street" }),
      ],
      cursor: { version: 1, lastSeen: {} },
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 20,
      staleAfterDays: 30,
      queue: listedQueue,
      persist: (state) => {
        saved.push(Object.keys(state.cursor.lastSeen));
      },
      fetchImpl: async (request) => {
        seen.push(`${request.kind}:${request.venueId}`);
        if (request.venueId === "b-search") throw new Error("Tavily request failed (503).");
        if (request.venueId === "c-extract" && request.kind === "extract") throw new Error("Tavily request failed (500).");
        const url = request.venueId === "a-ok"
          ? "https://eastbrookpub.co.uk/drinks"
          : request.venueId === "c-extract"
            ? "https://thealbion.co.uk/drinks"
            : "https://thehope.co.uk/drinks";
        const postcode = request.venueId === "a-ok" ? "IG11 7AB" : request.venueId === "c-extract" ? "N1 1AA" : "E8 1JH";
        if (request.kind === "search") {
          return {
            results: [{ url, title: request.venueId, content: `${postcode} London Pride £5.50 /pint` }],
            usage: { credits: 1 },
          };
        }
        return { results: [{ url, raw_content: "London Pride £5.50 /pint" }], usage: { credits: 1 } };
      },
    });
    expect(seen.map((row) => row.split(":")[1])).toEqual(["a-ok", "a-ok", "b-search", "c-extract", "c-extract", "d-ok", "d-ok"]);
    expect(saved).toEqual([["a-ok"], ["a-ok", "d-ok"]]);
    expect(result.cursor.lastSeen["b-search"]).toBeUndefined();
    expect(result.cursor.lastSeen["c-extract"]).toBeUndefined();
    expect(result.cursor.lastSeen["a-ok"]).toBe("2026-10-01");
    expect(result.cursor.lastSeen["d-ok"]).toBe("2026-10-01");
    expect(result.queue.venues.map((row) => row.venueId)).toEqual(["a-ok", "d-ok"]);
  });

  it("writes the queue before the cursor and stops when the queue write fails", async () => {
    const state = { queue: listedQueue, cursor: { version: 1 as const, lastSeen: { "a-ok": "2026-10-01" } } };
    const order: string[] = [];
    await saveNightlyProgress(state, {
      queue: () => {
        order.push("queue");
      },
      cursor: () => {
        order.push("cursor");
      },
    });
    expect(order).toEqual(["queue", "cursor"]);
    const failed: string[] = [];
    await expect(saveNightlyProgress(state, {
      queue: () => {
        failed.push("queue");
        throw new Error("disk");
      },
      cursor: () => {
        failed.push("cursor");
      },
    })).rejects.toThrow(/disk/);
    expect(failed).toEqual(["queue"]);
  });
});

