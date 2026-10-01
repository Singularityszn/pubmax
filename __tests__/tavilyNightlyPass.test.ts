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
    });
  });
});
