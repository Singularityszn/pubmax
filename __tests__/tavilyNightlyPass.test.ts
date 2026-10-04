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
import { defined } from "@/__tests__/helpers/defined";

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

  it("matches a seed neighbourhood in the borough, the name, or the address, not in a pint name", () => {
    const blue = toNightlyVenue({
      id: "blue-boar",
      name: "Blue Boar Pub",
      borough: "Westminster",
      cheapestPrice: 6,
      filterHints: {
        searchText: "blue boar pub tothill street, westminster, sw1h 9na westminster soho lager",
      },
    });
    const saint = toNightlyVenue({
      id: "lucky-saint",
      name: "The Lucky Saint",
      borough: "Westminster",
      cheapestPrice: 6,
      filterHints: {
        searchText: "the lucky saint 58 devonshire street, marylebone, w1g 7nf westminster camden hells",
      },
    });
    const named = toNightlyVenue({
      id: "soho-name",
      name: "The Soho Arms",
      borough: "Westminster",
      cheapestPrice: 6,
      filterHints: { searchText: "the soho arms 1 greek street, w1d 5dh westminster lager" },
    });
    const addressed = toNightlyVenue({
      id: "soho-street",
      name: "French House",
      borough: "Westminster",
      cheapestPrice: 6,
      filterHints: { searchText: "french house 49 dean street, soho, london, w1d 5dh westminster lager" },
    });
    const tail = venue({
      id: "tail",
      name: "Blue Boar Pub",
      borough: "Westminster",
      priced: true,
      areaText: "blue boar pub tothill street westminster soho lager",
    });
    const thin = venue({
      id: "thin",
      name: "Eastbrook",
      borough: "Barking and Dagenham",
      postcode: "IG11 7AB",
      priced: true,
    });
    expect(blue && saint && named && addressed).toBeTruthy();
    const order = selectNightlyVenues(
      [blue!, saint!, named!, addressed!, tail, thin],
      { version: 1, lastSeen: {} },
      { today: "2026-10-01", staleAfterDays: 30, limit: 10 },
    ).map((row) => row.id);
    expect(order).toEqual(["soho-name", "soho-street", "thin", "blue-boar", "lucky-saint", "tail"]);
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
          excerpts: [],
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
          excerpts: [],
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

  it("keeps a stated pint, a keg line, and a millilitre serving, and does not call a keg a pint", () => {
    const facts = factsFromPage(page, { sourceUrl, seenOn: "2026-10-01" });
    const byDrink = Object.fromEntries(facts.drinks.map((row) => [row.drink, row]));
    expect(byDrink["London Pride"]).toMatchObject({ size: "pint", priceGbp: 5.5, standing: "listed", sourceUrl, seenOn: "2026-10-01" });
    expect(byDrink["Somerset Cider"]).toMatchObject({ size: "pint", priceGbp: 4.8, standing: "listed" });
    expect(byDrink["Asahi Super Dry Draught Lager"]).toMatchObject({ size: "keg", priceGbp: 6.7, standing: "listed" });
    expect(facts.drinks.find((row) => row.drink === "Madri Lager")).toBeUndefined();
    expect(byDrink["Peroni Nastro Azzurro"]).toMatchObject({ size: "unstated", priceGbp: 6.55, sizeDetail: "330ml", standing: "listed" });
    expect(byDrink.Peroni).toMatchObject({ size: "unstated", sizeDetail: "half", priceGbp: 3.55, standing: "listed" });
    expect(facts.drinks.find((row) => row.priceGbp === 6)).toBeUndefined();
    expect(facts.drinks.find((row) => row.priceGbp === 50)).toBeUndefined();
    expect(facts.drinks.find((row) => /fiver|about/i.test(row.drink))).toBeUndefined();
    expect(facts.drinks.every((row) => row.standing === "listed")).toBe(true);
  });

  it("keeps the page verbatim for a curator, including hours and phone lines", () => {
    const drinks = factsFromPage(page, { sourceUrl, seenOn: "2026-10-01" });
    const foodPage = factsFromPage(extractFixture.results[1].raw_content, {
      sourceUrl: "https://eastbrookpub.co.uk/food-menu.pdf",
      seenOn: "2026-10-01",
    });
    expect(foodPage.excerpts).toEqual([
      {
        sourceUrl: "https://eastbrookpub.co.uk/food-menu.pdf",
        excerpt: extractFixture.results[1].raw_content,
        seenOn: "2026-10-01",
      },
    ]);
    expect(foodPage.drinks).toEqual([]);
    expect(drinks.excerpts[0]).toMatchObject({ sourceUrl, seenOn: "2026-10-01" });
    expect(defined(drinks.excerpts[0]).excerpt).toContain("Beer garden out the back.");
    expect(defined(drinks.excerpts[0]).excerpt).toContain("This pub is permanently closed.");
    expect(defined(drinks.excerpts[0]).excerpt).toContain("Monday 12pm to 11pm");
    expect(defined(drinks.excerpts[0]).excerpt).toContain("020 7946 0991");
    expect(drinks).not.toHaveProperty("hours");
    expect(drinks).not.toHaveProperty("phone");
    expect(drinks).not.toHaveProperty("food");
    expect(drinks).not.toHaveProperty("amenities");
    expect(drinks).not.toHaveProperty("closure");
  });

  it("stores a food line as the page text and does not invent a price from it", () => {
    const facts = factsFromPage("We serve food.\nMonday 12pm to 11pm", {
      sourceUrl: "https://example.test/about",
      seenOn: "2026-10-01",
    });
    expect(defined(facts.excerpts[0]).excerpt).toBe("We serve food.\nMonday 12pm to 11pm");
    expect(facts.drinks).toEqual([]);
    expect(facts).not.toHaveProperty("hours");
    expect(facts).not.toHaveProperty("phone");
  });

  it("stores an explicit no-food line verbatim", () => {
    const facts = factsFromPage("We do not serve food.", {
      sourceUrl: "https://example.test/about",
      seenOn: "2026-10-01",
    });
    expect(defined(facts.excerpts[0]).excerpt).toBe("We do not serve food.");
    expect(facts.drinks).toEqual([]);
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
          excerpts: facts.excerpts,
          candidates: [],
        },
      ],
    });
    expect(doc.standingRule).toBe("listed");
    expect(defined(defined(doc.venues[0]).drinks[0]).standing).toBe("listed");
    const encoded = JSON.stringify(doc);
    expect(encoded).not.toContain("confirmed");
    expect(encoded).not.toContain("cheapestPrice");
    expect(encoded).not.toContain("contributor");
  });

  it("keeps a listed price and excerpt whose source URL carries a space the URL parser encodes", () => {
    const sourceUrl = "https://eastbrookpub.co.uk/drink menu.html";
    const facts = factsFromPage("London Pride £5.50 /pint", { sourceUrl, seenOn: "2026-10-01" });
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
          excerpts: facts.excerpts,
          candidates: [sourceUrl, "https://user:pass@eastbrookpub.co.uk/"],
        },
      ],
    });
    expect(defined(defined(doc.venues[0]).drinks[0]).sourceUrl).toBe(sourceUrl);
    expect(defined(doc.venues[0]).excerpts.length).toBeGreaterThan(0);
    expect(defined(doc.venues[0]).candidates).toEqual([sourceUrl]);
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
            excerpts: [],
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
    expect(defined(first.queue.venues[0]).drinks.every((row) => row.standing === "listed")).toBe(true);
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

function expectDrinkNameOwnedByLine(text: string, drinks: ReadonlyArray<{ drink: string }>): void {
  for (const drink of drinks) {
    expect(text.includes(drink.drink), text).toBe(true);
    for (const other of drinks) {
      if (other.drink === drink.drink) continue;
      expect(drink.drink.includes(other.drink), text).toBe(false);
    }
  }
}

describe("a price stays in the lane the reader gave it", () => {
  const rows: Array<{
      text: string;
      drinks: Array<{ drink: string; size: string; sizeDetail: string | null; priceGbp: number }>;
      excerpt?: boolean;
    }> = [
      {
        text: "Pie of the day. Guinness £6.20 pint",
        drinks: [{ drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 6.2 }],
      },
      {
        text: "Peroni £3.55/£7.10 pint",
        drinks: [
          { drink: "Peroni", size: "pint", sizeDetail: "pint", priceGbp: 7.1 },
        ],
      },
      {
        text: "Pie of the day. Peroni Half £3.10",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "half", priceGbp: 3.1 }],
      },
      {
        text: "Pie of the day. Peroni £3.55|£7.10",
        drinks: [],
      },
      {
        text: "Peroni £5.20/£5.80 bottle",
        drinks: [
          { drink: "Peroni", size: "bottle", sizeDetail: "bottle", priceGbp: 5.8 },
        ],
      },
      {
        text: "Peroni 330ml £4.50/£5.50",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
        ],
      },
      {
        text: "Peroni £3.55|£7.10",
        drinks: [],
      },
      {
        text: "House Merlot 175ml £6.50 / 250ml £8.50",
        drinks: [
          { drink: "House Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
          { drink: "House Merlot", size: "unstated", sizeDetail: "250ml", priceGbp: 8.5 },
        ],
      },
      {
        text: "The Crown, 1 Bankside, SE1 6AN. London Pride £5.50 /pint",
        drinks: [
          { drink: "London Pride", size: "pint", sizeDetail: "pint", priceGbp: 5.5 },
        ],
      },
      { text: "Scotch egg £6.50\nRum baba £7", drinks: [] },
      { text: "Burger Peroni Half £3.55", drinks: [] },
      {
        text: "Guinness pint £6.20 | Peroni 330ml bottle £5.50",
        drinks: [
          { drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 6.2 },
          { drink: "Peroni", size: "bottle", sizeDetail: "330ml", priceGbp: 5.5 },
        ],
      },
      {
        text: "Peroni Half £3.55",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "half", priceGbp: 3.55 }],
      },
      {
        text: "Burger. Peroni Half £3.55",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "half", priceGbp: 3.55 }],
      },
      {
        text: "Coca-Cola can £1.50\nHouse Merlot 175ml £14.50\nEspresso Martini glass £13.00\nNameless 330ml £1.50\nPeroni 330ml £6.55",
        drinks: [
          { drink: "Coca-Cola", size: "can", sizeDetail: "can", priceGbp: 1.5 },
          { drink: "House Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 14.5 },
          { drink: "Espresso Martini", size: "unstated", sizeDetail: null, priceGbp: 13 },
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 6.55 },
        ],
      },
      {
        text: "Sauvignon 125ml £6.50\nHouse Merlot 175ml £14.50\nPinot 250ml £8.00\nAsahi 500ml keg £6.70\nPeroni 330ml bottle £6.55\nCoca-Cola 330ml can £1.50",
        drinks: [
          { drink: "Sauvignon", size: "unstated", sizeDetail: "125ml", priceGbp: 6.5 },
          { drink: "House Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 14.5 },
          { drink: "Pinot", size: "unstated", sizeDetail: "250ml", priceGbp: 8 },
          { drink: "Asahi", size: "keg", sizeDetail: "500ml", priceGbp: 6.7 },
          { drink: "Peroni", size: "bottle", sizeDetail: "330ml", priceGbp: 6.55 },
          { drink: "Coca-Cola", size: "can", sizeDetail: "330ml", priceGbp: 1.5 },
        ],
      },
      {
        text: "London Pride £5.50 /pint. Burger £12.00\nBurger £12.00. Peroni £5.50 /pint\nHouse Merlot 175ml £14.50. Pie £9.00",
        drinks: [
          { drink: "London Pride", size: "pint", sizeDetail: "pint", priceGbp: 5.5 },
          { drink: "Peroni", size: "pint", sizeDetail: "pint", priceGbp: 5.5 },
          { drink: "House Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 14.5 },
        ],
      },
      { text: "Burger from £12.00", drinks: [] },
      { text: "Fish and chips £14.50", drinks: [] },
      { text: "Burger. House wine £40.00", drinks: [] },
      {
        text: "Gordon's 25ml £4.50",
        drinks: [{ drink: "Gordon's", size: "unstated", sizeDetail: "25ml", priceGbp: 4.5 }],
      },
      {
        text: "Double Gordon's 50ml £7.20",
        drinks: [{ drink: "Double Gordon's", size: "unstated", sizeDetail: "50ml", priceGbp: 7.2 }],
      },
      {
        text: "Tequila 25ml £3.50",
        drinks: [{ drink: "Tequila", size: "unstated", sizeDetail: "25ml", priceGbp: 3.5 }],
      },
      {
        text: "Patron 25ml £6.00",
        drinks: [{ drink: "Patron", size: "unstated", sizeDetail: "25ml", priceGbp: 6 }],
      },
      {
        text: "Guinness £6.20 /pint | 175ml £7.50",
        drinks: [{ drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 6.2 }],
      },
      {
        text: "London Pride £5.50 /pint. 175ml £6.50",
        drinks: [{ drink: "London Pride", size: "pint", sizeDetail: "pint", priceGbp: 5.5 }],
      },
      {
        text: "Sauvignon 125ml £6.50 / 175ml £6.50",
        drinks: [
          { drink: "Sauvignon", size: "unstated", sizeDetail: "125ml", priceGbp: 6.5 },
          { drink: "Sauvignon", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
        ],
      },
      {
        text: "Peroni schooner £5.40",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "schooner", priceGbp: 5.4 }],
      },
      {
        text: "Peroni two-thirds £5.20",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "two-thirds", priceGbp: 5.2 }],
      },
      {
        text: "Peroni 500ml £5.50",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "500ml", priceGbp: 5.5 }],
      },
      {
        text: "Neck Oil 440ml £6.00",
        drinks: [{ drink: "Neck Oil", size: "unstated", sizeDetail: "440ml", priceGbp: 6 }],
      },
      {
        text: "Rekorderlig cider 500ml £5.80",
        drinks: [{ drink: "Rekorderlig cider", size: "unstated", sizeDetail: "500ml", priceGbp: 5.8 }],
      },
      {
        text: "Peroni 275ml £4.80",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "275ml", priceGbp: 4.8 }],
      },
      {
        text: "Coca-Cola 440ml £1.80",
        drinks: [{ drink: "Coca-Cola", size: "unstated", sizeDetail: "440ml", priceGbp: 1.8 }],
      },
      {
        text: "Punk IPA 500ml £6.50",
        drinks: [{ drink: "Punk IPA", size: "unstated", sizeDetail: "500ml", priceGbp: 6.5 }],
      },
      {
        text: "Peroni 330ml £4.50",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 }],
      },
      {
        text: "Peroni two-thirds pint £5.20",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "two-thirds", priceGbp: 5.2 }],
      },
      {
        text: "Peroni half pint £3.55",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "half", priceGbp: 3.55 }],
      },
      {
        text: "Peroni 2/3 pint £5.20",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "two-thirds", priceGbp: 5.2 }],
      },
      {
        text: "Peroni ⅔ pint £5.20",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "two-thirds", priceGbp: 5.2 }],
      },
      {
        text: "Peroni 1/2 pint £3.55",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "half", priceGbp: 3.55 }],
      },
      {
        text: "Peroni ½ pint £3.55",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "half", priceGbp: 3.55 }],
      },
      {
        text: "Peroni two-thirds of a pint £5.20",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "two-thirds", priceGbp: 5.2 }],
      },
      {
        text: "Peroni schooner (2/3 pint) £5.40",
        drinks: [{ drink: "Peroni", size: "unstated", sizeDetail: "schooner", priceGbp: 5.4 }],
      },
      {
        text: "Coca-Cola 250ml can £2.00",
        drinks: [{ drink: "Coca-Cola", size: "can", sizeDetail: "250ml", priceGbp: 2 }],
      },
      {
        text: "Peroni 250ml bottle £5.00",
        drinks: [{ drink: "Peroni", size: "bottle", sizeDetail: "250ml", priceGbp: 5 }],
      },
      {
        text: "House Merlot 175ml £6.50 | 250ml £8.50",
        drinks: [
          { drink: "House Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
          { drink: "House Merlot", size: "unstated", sizeDetail: "250ml", priceGbp: 8.5 },
        ],
      },
      {
        text: "Sauvignon 125ml £6.50 | 175ml £7.50",
        drinks: [
          { drink: "Sauvignon", size: "unstated", sizeDetail: "125ml", priceGbp: 6.5 },
          { drink: "Sauvignon", size: "unstated", sizeDetail: "175ml", priceGbp: 7.5 },
        ],
      },
      {
        text: "House wine 125ml £5.50 | 175ml £6.50 | 250ml £8.00",
        drinks: [
          { drink: "House wine", size: "unstated", sizeDetail: "125ml", priceGbp: 5.5 },
          { drink: "House wine", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
          { drink: "House wine", size: "unstated", sizeDetail: "250ml", priceGbp: 8 },
        ],
      },
      { text: "Peroni 2/3 £5.20", drinks: [] },
      { text: "Peroni ½ £3.55", drinks: [] },
      { text: "Peroni 1/2 £3.55", drinks: [] },
      {
        text: "House Merlot 1/2 bottle £12.00",
        drinks: [{ drink: "House Merlot", size: "unstated", sizeDetail: "half bottle", priceGbp: 12 }],
      },
      {
        text: "House Merlot ½ bottle £12.00",
        drinks: [{ drink: "House Merlot", size: "unstated", sizeDetail: "half bottle", priceGbp: 12 }],
      },
      {
        text: "House Merlot half bottle £12.00",
        drinks: [{ drink: "House Merlot", size: "unstated", sizeDetail: "half bottle", priceGbp: 12 }],
      },
      {
        text: "House Merlot half-bottle £12.00",
        drinks: [{ drink: "House Merlot", size: "unstated", sizeDetail: "half bottle", priceGbp: 12 }],
      },
      {
        text: "Peroni half £3.55 / bottle £5.20",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "half", priceGbp: 3.55 },
          { drink: "Peroni", size: "bottle", sizeDetail: "bottle", priceGbp: 5.2 },
        ],
      },
      { text: "Guinness 1½ pint £8.50", drinks: [] },
      { text: "Guinness 2 1/2 pint £8.50", drinks: [] },
      { text: "Guinness 2 1/2 pint £9.00", drinks: [] },
      {
        text: "Rioja 2018/19 175ml £7.50",
        drinks: [{ drink: "Rioja 2018/19", size: "unstated", sizeDetail: "175ml", priceGbp: 7.5 }],
      },
      {
        text: "Malbec 2021/22 175ml £8.50",
        drinks: [{ drink: "Malbec 2021/22", size: "unstated", sizeDetail: "175ml", priceGbp: 8.5 }],
      },
      {
        text: "House Merlot 175/250ml £7.50",
        drinks: [],
        excerpt: true,
      },
      {
        text: "House Merlot 175/250ml £6.50/£8.50",
        drinks: [
          { drink: "House Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
          { drink: "House Merlot", size: "unstated", sizeDetail: "250ml", priceGbp: 8.5 },
        ],
      },
      {
        text: "House Merlot 175ml/250ml £6.50/£8.50",
        drinks: [
          { drink: "House Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
          { drink: "House Merlot", size: "unstated", sizeDetail: "250ml", priceGbp: 8.5 },
        ],
      },
      {
        text: "House Merlot 175ml / 250ml £6.50 / £8.50",
        drinks: [
          { drink: "House Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
          { drink: "House Merlot", size: "unstated", sizeDetail: "250ml", priceGbp: 8.5 },
        ],
      },
      {
        text: "House wine 125/175/250ml £5.50/£6.50/£8.00",
        drinks: [
          { drink: "House wine", size: "unstated", sizeDetail: "125ml", priceGbp: 5.5 },
          { drink: "House wine", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
          { drink: "House wine", size: "unstated", sizeDetail: "250ml", priceGbp: 8 },
        ],
      },
      {
        text: "House wine 125ml/175ml/250ml £5.50/£6.50/£8.00",
        drinks: [
          { drink: "House wine", size: "unstated", sizeDetail: "125ml", priceGbp: 5.5 },
          { drink: "House wine", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
          { drink: "House wine", size: "unstated", sizeDetail: "250ml", priceGbp: 8 },
        ],
      },
      {
        text: "Lager 275/330/440/500ml £4.00/£4.50/£5.50/£6.00",
        drinks: [
          { drink: "Lager", size: "unstated", sizeDetail: "275ml", priceGbp: 4 },
          { drink: "Lager", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Lager", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Lager", size: "unstated", sizeDetail: "500ml", priceGbp: 6 },
        ],
      },
      {
        text: "Guinness pint £5.80. House Merlot 175/250ml £7.50",
        drinks: [{ drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 5.8 }],
        excerpt: true,
      },
      {
        text: "Guinness pint £5.80 | House Merlot 175/250ml £7.50",
        drinks: [{ drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 5.8 }],
        excerpt: true,
      },
      {
        text: "Guinness pint £5.80 House Merlot 175/250ml £7.50",
        drinks: [{ drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 5.8 }],
        excerpt: true,
      },
      {
        text: "House wine 125/175ml £5.50/£6.50. House Merlot 175/250ml £7.50",
        drinks: [
          { drink: "House wine", size: "unstated", sizeDetail: "125ml", priceGbp: 5.5 },
          { drink: "House wine", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
        ],
        excerpt: true,
      },
      {
        text: "House wine 125/175ml £5.50/£6.50 | House Merlot 175/250ml £7.50",
        drinks: [
          { drink: "House wine", size: "unstated", sizeDetail: "125ml", priceGbp: 5.5 },
          { drink: "House wine", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
        ],
        excerpt: true,
      },
      {
        text: "House wine 125/175ml £5.50/£6.50 House Merlot 175/250ml £7.50",
        drinks: [
          { drink: "House wine", size: "unstated", sizeDetail: "125ml", priceGbp: 5.5 },
          { drink: "House wine", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
        ],
        excerpt: true,
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50 / bottle £6.00",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Peroni", size: "bottle", sizeDetail: "bottle", priceGbp: 6 },
        ],
      },
      {
        text: "House Merlot 175/250ml £6.50/£8.50 / bottle £16.00",
        drinks: [
          { drink: "House Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
          { drink: "House Merlot", size: "unstated", sizeDetail: "250ml", priceGbp: 8.5 },
          { drink: "House Merlot", size: "bottle", sizeDetail: "bottle", priceGbp: 16 },
        ],
      },
      {
        text: "Rioja 175ml £7.50",
        drinks: [{ drink: "Rioja", size: "unstated", sizeDetail: "175ml", priceGbp: 7.5 }],
      },
      {
        text: "Landlord pint £4.80 / 1/2 £2.40",
        drinks: [{ drink: "Landlord", size: "pint", sizeDetail: "pint", priceGbp: 4.8 }],
      },
      {
        text: "Landlord pint £4.80 / half £2.40",
        drinks: [
          { drink: "Landlord", size: "pint", sizeDetail: "pint", priceGbp: 4.8 },
          { drink: "Landlord", size: "unstated", sizeDetail: "half", priceGbp: 2.4 },
        ],
      },
      {
        text: "Pint of Guinness £6",
        drinks: [{ drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 6 }],
      },
      {
        text: "Bottle of Moretti £5.20",
        drinks: [{ drink: "Moretti", size: "bottle", sizeDetail: "bottle", priceGbp: 5.2 }],
      },
      {
        text: "Glass of Merlot 175ml £7.50",
        drinks: [{ drink: "Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 7.5 }],
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50 Pint of Guinness £5.80",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 5.8 },
        ],
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50 | Pint of Guinness £5.80",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 5.8 },
        ],
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50. Pint of Guinness £5.80",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 5.8 },
        ],
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50 Bottle of Moretti £5.20",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Moretti", size: "bottle", sizeDetail: "bottle", priceGbp: 5.2 },
        ],
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50 Glass of Merlot 175ml £7.50",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 7.5 },
        ],
      },
      {
        text: "Peroni 330/440ml £4.50 Pint of Guinness £5.80",
        drinks: [{ drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 5.8 }],
        excerpt: true,
      },
      {
        text: "Sauvignon 125/175ml £6.50/£7.50 2018/19 Rioja 175ml £8.50",
        drinks: [
          { drink: "Sauvignon", size: "unstated", sizeDetail: "125ml", priceGbp: 6.5 },
          { drink: "Sauvignon", size: "unstated", sizeDetail: "175ml", priceGbp: 7.5 },
          { drink: "2018/19 Rioja", size: "unstated", sizeDetail: "175ml", priceGbp: 8.5 },
        ],
      },
      {
        text: "pint of Guinness £6",
        drinks: [{ drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 6 }],
      },
      {
        text: "Pint Of Guinness £6",
        drinks: [{ drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 6 }],
      },
      {
        text: "PINT OF GUINNESS £6",
        drinks: [{ drink: "GUINNESS", size: "pint", sizeDetail: "pint", priceGbp: 6 }],
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50 pint of Guinness £5.80",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 5.8 },
        ],
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50 Pint Of Guinness £5.80",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 5.8 },
        ],
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50 PINT OF GUINNESS £5.80",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "GUINNESS", size: "pint", sizeDetail: "pint", priceGbp: 5.8 },
        ],
      },
      {
        text: "Measure of Jameson 25ml £4.50",
        drinks: [{ drink: "Jameson", size: "unstated", sizeDetail: "25ml", priceGbp: 4.5 }],
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50 Measure of Jameson 25ml £4.50",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Jameson", size: "unstated", sizeDetail: "25ml", priceGbp: 4.5 },
        ],
      },
      {
        text: "Schooner of Neck Oil £6",
        drinks: [{ drink: "Neck Oil", size: "unstated", sizeDetail: "schooner", priceGbp: 6 }],
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50 Schooner of Neck Oil £6",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Neck Oil", size: "unstated", sizeDetail: "schooner", priceGbp: 6 },
        ],
      },
      {
        text: "Two-thirds of Guinness £5.20",
        drinks: [{ drink: "Guinness", size: "unstated", sizeDetail: "two-thirds", priceGbp: 5.2 }],
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50 Two-thirds of Guinness £5.20",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Guinness", size: "unstated", sizeDetail: "two-thirds", priceGbp: 5.2 },
        ],
      },
      {
        text: "A pint of Guinness £6",
        drinks: [{ drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 6 }],
      },
      {
        text: "Peroni 330/440ml £4.50/£5.50 A pint of Guinness £6",
        drinks: [
          { drink: "Peroni", size: "unstated", sizeDetail: "330ml", priceGbp: 4.5 },
          { drink: "Peroni", size: "unstated", sizeDetail: "440ml", priceGbp: 5.5 },
          { drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 6 },
        ],
      },
    ];

  it("keeps the priced lines this pass already decided", () => {
    for (const row of rows) {
      const facts = factsFromPage(row.text, pageFact);
      const drinks = facts.drinks.map((drink) => ({
        drink: drink.drink,
        size: drink.size,
        sizeDetail: drink.sizeDetail,
        priceGbp: drink.priceGbp,
      }));
      expect(drinks, row.text).toEqual(row.drinks);
      if (row.excerpt) {
        expect(facts.excerpts, row.text).toEqual([
          { sourceUrl: pageFact.sourceUrl, excerpt: row.text, seenOn: pageFact.seenOn },
        ]);
      }
    }
  });

  it("keeps each stored drink name inside its own item", () => {
    for (const row of rows) {
      const facts = factsFromPage(row.text, pageFact);
      expectDrinkNameOwnedByLine(row.text, facts.drinks);
    }
  });

  it("keeps both glasses when a later night prices the second size the same", () => {
    const glass = (sizeDetail: string, seenOn: string) => ({
      drink: "Sauvignon",
      size: "unstated" as const,
      sizeDetail,
      priceGbp: 6.5,
      standing: "listed" as const,
      sourceUrl: pageFact.sourceUrl,
      seenOn,
    });
    const night = (drinks: ReturnType<typeof glass>[], seenOn: string) => ({
      venueId: "eastbrook",
      name: "Eastbrook",
      postcode: "IG11 7AB",
      borough: "Barking and Dagenham",
      seenOn,
      website: null,
      drinks,
      excerpts: [],
      candidates: [],
    });
    const queued = mergeQueue(
      { version: 1, standingRule: "listed", venues: [night([glass("125ml", "2026-10-01")], "2026-10-01")] },
      [night([glass("175ml", "2026-10-02")], "2026-10-02")],
    );
    expect(defined(queued.venues[0]).drinks.map((row) => row.sizeDetail)).toEqual(["125ml", "175ml"]);
  });

  it("leaves an offer, a half and a food price out of the drink list and keeps the lines verbatim", () => {
    const page = "Burger from £12.00\nBurger Peroni Half £3.55\nBurger. House wine £40.00\nFish and chips £14.50\nBurger £12.00";
    const facts = factsFromPage(page, pageFact);
    expect(facts.drinks).toEqual([]);
    expect(defined(facts.excerpts[0]).excerpt).toBe(page);
    expect(defined(facts.excerpts[0]).sourceUrl).toBe(pageFact.sourceUrl);
  });

  it("keeps a sized drink on the same line as a dish and leaves the dish in the excerpt", () => {
    const page = "London Pride £5.50 /pint. Burger £12.00\nBurger £12.00. Peroni £5.50 /pint\nHouse Merlot 175ml £14.50. Pie £9.00";
    const facts = factsFromPage(page, pageFact);
    expect(facts.drinks.map((row) => `${row.drink}|${row.priceGbp}`).sort()).toEqual([
      "House Merlot|14.5",
      "London Pride|5.5",
      "Peroni|5.5",
    ]);
    expect(defined(facts.excerpts[0]).excerpt).toBe(page);
    expect(facts.drinks.find((row) => /burger|pie/i.test(row.drink))).toBeUndefined();
  });

  it("keeps a kitchen line verbatim beside the pint and does not turn it into a served flag", () => {
    const ours = factsFromPage("Our kitchen is closed.\nLondon Pride £5.50 /pint", pageFact);
    expect(defined(ours.excerpts[0]).excerpt).toContain("Our kitchen is closed.");
    expect(ours.drinks.map((row) => row.drink)).toContain("London Pride");
    expect(ours).not.toHaveProperty("food");
    const qualified = factsFromPage("The kitchen is closed on Mondays.\nThe kitchen was closed for refurbishment.", pageFact);
    expect(defined(qualified.excerpts[0]).excerpt).toContain("The kitchen is closed on Mondays.");
    expect(defined(qualified.excerpts[0]).excerpt).toContain("The kitchen was closed for refurbishment.");
    expect(qualified.drinks).toEqual([]);
  });

  it("does not price a bare menu, and a drinks heading still beats a food title", () => {
    const lunch = "London Pride £5.50 /pint\nGuinness £5.80 /pint\nAsahi £6.20 /pint\nMadri £6.10 /pint\nScotch egg £6.50";
    const bare = factsFromPage(lunch, {
      sourceUrl: "https://pub.example/menu",
      seenOn: "2026-10-01",
      title: "Sunday lunch",
    });
    expect(bare.drinks).toEqual([]);
    expect(defined(bare.excerpts[0]).excerpt).toContain("Scotch egg £6.50");
    const headed = "Draught beer\nLondon Pride £5.50 /pint\nBottled beers\nPeroni 330ml bottle £5.50\nCask ale\nLandlord £4.20 /pint\nFood\nScotch egg £6.50\nRum baba £7";
    const menu = factsFromPage(headed, {
      sourceUrl: "https://pub.example/menu",
      seenOn: "2026-10-01",
      title: "Sunday lunch",
    });
    expect(menu.drinks.map((row) => `${row.drink}|${row.size}|${row.priceGbp}`).sort()).toEqual([
      "Landlord|pint|4.2",
      "London Pride|pint|5.5",
      "Peroni|bottle|5.5",
    ]);
    expect(menu.drinks.find((row) => /scotch|rum|baba/i.test(row.drink))).toBeUndefined();
    expect(defined(menu.excerpts[0]).excerpt).toContain("Scotch egg £6.50");
  });

  it("keeps scotch egg and rum baba off a food menu and out of a food section", () => {
    const food = "Scotch egg £6.50\nRum baba £7";
    const foodPage = factsFromPage(food, {
      sourceUrl: "https://eastbrookpub.co.uk/food-menu.pdf",
      seenOn: "2026-10-01",
      title: "Food menu",
    });
    expect(foodPage.drinks).toEqual([]);
    expect(defined(foodPage.excerpts[0]).excerpt).toBe(food);
    const mixed = "London Pride £5.50 /pint\nFood\nScotch egg £6.50\nRum baba £7\nBeer\nGuinness £5.80 /pint";
    const drinksPage = factsFromPage(mixed, pageFact);
    expect(drinksPage.drinks.map((row) => row.drink).sort()).toEqual(["Guinness", "London Pride"]);
    expect(defined(drinksPage.excerpts[0]).excerpt).toBe(mixed);
  });

  it("keeps a sized pint when the path or heading names food and drink", () => {
    const line = "London Pride £5.50 /pint\nScotch egg £6.50";
    const mixedPath = factsFromPage(line, {
      sourceUrl: "https://pub.example/food-and-drink",
      seenOn: "2026-10-01",
      title: "Drinks",
    });
    expect(mixedPath.drinks.map((row) => row.drink)).toEqual(["London Pride"]);
    expect(defined(mixedPath.excerpts[0]).excerpt).toContain("Scotch egg £6.50");
    const headed = factsFromPage(`Food and Drink\n${line}`, {
      sourceUrl: "https://pub.example/menu",
      seenOn: "2026-10-01",
      title: "Sunday lunch",
    });
    expect(headed.drinks.map((row) => row.drink)).toEqual(["London Pride"]);
    const bound = factsFromPage(line, {
      sourceUrl: "https://pub.example/bar-food",
      seenOn: "2026-10-01",
      title: "The Crown",
      boundSnippet: true,
    });
    expect(bound.drinks.map((row) => row.drink)).toEqual(["London Pride"]);
    const foodOnly = factsFromPage("Beer\nLondon Pride £5.50 /pint", {
      sourceUrl: "https://pub.example/food-menu.pdf",
      seenOn: "2026-10-01",
      title: "Drinks",
      boundSnippet: true,
    });
    expect(foodOnly.drinks).toEqual([]);
    const foodHeading = factsFromPage("Food\nLondon Pride £5.50 /pint", {
      sourceUrl: "https://pub.example/drinks",
      seenOn: "2026-10-01",
      title: "Drinks",
    });
    expect(foodHeading.drinks).toEqual([]);
  });

  it("does not queue a dish on a drinks url when the line states no serving size", () => {
    const page = "Scotch egg £6.50\nRum baba £7";
    const facts = factsFromPage(page, pageFact);
    expect(facts.drinks).toEqual([]);
    expect(defined(facts.excerpts[0]).excerpt).toContain("Scotch egg £6.50");
    expect(defined(facts.excerpts[0]).excerpt).toContain("Rum baba £7");
  });

  it("keeps sized pints on a drinks-titled menu when food lines are as many", () => {
    const page = [
      "London Pride £5.50 /pint",
      "Guinness £5.80 /pint",
      "Asahi £6.20 /pint",
      "Madri £6.10 /pint",
      "Burger £12.00",
      "Pie £9.00",
      "Chips £4.00",
      "Fish £14.00",
    ].join("\n");
    const facts = factsFromPage(page, {
      sourceUrl: "https://pub.example/menu",
      seenOn: "2026-10-01",
      title: "Drinks",
    });
    expect(facts.drinks.map((row) => row.drink).sort()).toEqual(["Asahi", "Guinness", "London Pride", "Madri"]);
  });

  it("keeps closure wording verbatim and does not treat an open kitchen or a former name as a closure field", () => {
    const open = factsFromPage("The kitchen is now closed.\nFormerly known as The Red Lion.\nLondon Pride £5.50 /pint", pageFact);
    expect(defined(open.excerpts[0]).excerpt).toContain("The kitchen is now closed.");
    expect(defined(open.excerpts[0]).excerpt).toContain("Formerly known as The Red Lion.");
    expect(open.drinks.map((row) => row.drink)).toContain("London Pride");
    expect(open).not.toHaveProperty("closure");
    const shut = factsFromPage("This pub is permanently closed.\nThe bar is closed for good.", pageFact);
    expect(defined(shut.excerpts[0]).excerpt).toContain("This pub is permanently closed.");
    expect(shut.drinks).toEqual([]);
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
    expect(chooseOperatorUrl([
      { url: "https://thecrown-bankside.co.uk/drinks", title: "The Crown", content: "Visit SE16AN today" },
    ], bankside)).toBeNull();
  });

  it("binds a postcode match when the domain omits the pub name, and prefers a name-bearing host", () => {
    const hope = venue({ name: "The Hope", postcode: "E8 1JH", street: "3 Mare Street" });
    const mare = { url: "https://marestreet.co.uk/drinks", title: "Drinks", content: "3 Mare Street, E8 1JH. London Pride £5.50 /pint" };
    expect(chooseOperatorUrl([mare], hope)).toBe("https://marestreet.co.uk/drinks");
    expect(chooseOperatorUrl([
      mare,
      { url: "https://thehope.co.uk/drinks", title: "Drinks", content: "3 Mare Street, E8 1JH" },
    ], hope)).toBe("https://thehope.co.uk/drinks");
  });

  it("does not bind, extract, or store a url robots refuses, and keeps an allowed candidate", async () => {
    const refused = "https://thecrown-bankside.co.uk/drinks";
    const allowed = "https://thecrown.co.uk/drinks";
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
      robotsChecker: async (url) => ({
        allowed: url !== refused,
        reason: url === refused ? "robots-unreadable" : "allowed",
        evidence: "refused",
      }),
      fetchImpl: async (request) => {
        calls.push(request.kind);
        return {
          results: [
            { url: refused, title: "The Crown", content: "SE1 6AN. London Pride £5.50 /pint" },
            { url: allowed, title: "The Crown", content: "A different pub." },
          ],
          usage: { credits: 1 },
        };
      },
    });
    expect(calls).toEqual(["search"]);
    expect(defined(result.queue.venues[0]).drinks).toEqual([]);
    expect(defined(result.queue.venues[0]).website).toBeNull();
    expect(defined(result.queue.venues[0]).candidates).toEqual([allowed]);
    expect(defined(result.queue.venues[0]).excerpts.some((row) => row.sourceUrl === refused)).toBe(false);
    expect(result.cursor.lastSeen["crown-se1"]).toBeUndefined();
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
    expect(result.cursor.lastSeen["crown-se1"]).toBe("2026-10-01");
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
    expect(defined(byId["crown-se1"]).website?.url).toBe("https://thecrown-bankside.co.uk/drinks");
    expect(defined(byId["crown-se1"]).drinks.map((row) => row.priceGbp)).toEqual([6.1]);
    expect(defined(byId["crown-e1"]).website?.url).toBe("https://thecrown-cable.co.uk/drinks");
    expect(defined(byId["crown-e1"]).drinks.map((row) => row.priceGbp)).toEqual([5.2]);
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
    expect(chooseOperatorUrl([{
      url: "https://lordnelsonpub.co.uk/menu",
      title: "The Lord Nelson",
      content: "Pie £9.11. Enfield Road parking",
    }], { ...nelson, street: "9 11 Enfield Road" })).toBeNull();
    expect(chooseOperatorUrl([{
      url: "https://lordnelsonpub.co.uk/menu",
      title: "The Lord Nelson",
      content: "Burger £12. High Street specials",
    }], { ...nelson, street: "12 high street" })).toBeNull();
    expect(chooseOperatorUrl([{
      url: "https://lordnelsonpub.co.uk/menu",
      title: "The Lord Nelson",
      content: "12 High Street. Pie £8",
    }], { ...nelson, street: "12 high street" })).toBe("https://lordnelsonpub.co.uk/menu");
    expect(chooseOperatorUrl([{
      url: "https://lordnelsonpub.co.uk/menu",
      title: "The Lord Nelson",
      content: "Open from 12. High Street specials",
    }], { ...nelson, street: "12 high street" })).toBeNull();
    expect(chooseOperatorUrl([{
      url: "https://lordnelsonpub.co.uk/menu",
      title: "The Lord Nelson",
      content: "Food served 12-15. Horseshoe Lane",
    }], { ...nelson, street: "12 15 horseshoe lane" })).toBeNull();
  });
});

describe("a night that fails part way", () => {
  it("advances unbound searches so the next night reaches the venue those misses sat in front of", async () => {
    const misses = [
      venue({ id: "a-miss", name: "The Alpha", postcode: "E1 1AA", street: "1 Alpha Road", borough: "Hackney" }),
      venue({ id: "b-miss", name: "The Beta", postcode: "E2 2BB", street: "2 Beta Road", borough: "Hackney" }),
    ];
    const hit = venue({ id: "c-hit", name: "The Crown", postcode: "SE1 6AN", street: "1 Bankside", borough: "Hackney" });
    const calls: string[] = [];
    const fetchImpl = async (request: { kind: string; venueId: string }) => {
      calls.push(`${request.kind}:${request.venueId}`);
      if (request.venueId === "c-hit") {
        if (request.kind === "search") {
          return {
            results: [{
              url: "https://thecrown-bankside.co.uk/drinks",
              title: "The Crown",
              content: "The Crown, 1 Bankside, SE1 6AN. London Pride £5.50 /pint",
            }],
            usage: { credits: 1 },
          };
        }
        return {
          results: [{ url: "https://thecrown-bankside.co.uk/drinks", raw_content: "London Pride £5.50 /pint" }],
          usage: { credits: 1 },
        };
      }
      return {
        results: [{
          url: "https://thecrown.co.uk/drinks",
          title: request.venueId,
          content: "London Pride £5.50 /pint. Open 11am.",
        }],
        usage: { credits: 1 },
      };
    };
    const first = await runNightlyPass({
      venues: [...misses, hit],
      cursor: { version: 1, lastSeen: {} },
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 2,
      staleAfterDays: 30,
      queue: listedQueue,
      fetchImpl,
    });
    expect(calls).toEqual(["search:a-miss", "search:b-miss"]);
    expect(first.cursor.lastSeen["a-miss"]).toBe("2026-10-01");
    expect(first.cursor.lastSeen["b-miss"]).toBe("2026-10-01");
    expect(first.cursor.lastSeen["c-hit"]).toBeUndefined();
    const later = await runNightlyPass({
      venues: [...misses, hit],
      cursor: first.cursor,
      usage: researcher,
      now: new Date("2026-10-02T12:00:00.000Z"),
      reserveCredits: 0,
      manualCap: 2,
      staleAfterDays: 30,
      queue: first.queue,
      fetchImpl,
    });
    expect(later.cursor.lastSeen["c-hit"]).toBe("2026-10-02");
    expect(calls.filter((row) => row.endsWith(":c-hit"))).toEqual(["search:c-hit", "extract:c-hit"]);
    expect(later.queue.venues.find((row) => row.venueId === "c-hit")?.drinks.map((row) => row.priceGbp)).toEqual([5.5]);
  });

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
    expect(defined(result.queue.venues[0]).excerpts.map((row) => row.excerpt).join("\n")).toContain("Burger £12.00");
    expect(defined(result.queue.venues[0]).drinks.map((row) => row.drink)).toContain("London Pride");
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
    expect(defined(first.queue.venues[0]).drinks.map((row) => row.priceGbp)).toEqual([5.5]);
    expect(defined(first.queue.venues[0]).excerpts.map((row) => row.excerpt).join("\n")).toContain("Burger £12.00");
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
    expect(later.cursor.lastSeen["crown-se1"]).toBe("2026-09-01");
    expect(later.queue.venues).toHaveLength(1);
    expect(defined(later.queue.venues[0]).drinks.map((row) => row.priceGbp)).toEqual([5.5]);
    expect(defined(later.queue.venues[0]).excerpts.map((row) => row.excerpt).join("\n")).toContain("Burger £12.00");
    expect(defined(later.queue.venues[0]).website?.url).toBe("https://thecrown-bankside.co.uk/drinks");
  });

  it("does not mark a venue seen on an error payload, and marks a food-only read seen", async () => {
    const pub = venue({
      id: "crown-se1",
      name: "The Crown",
      postcode: "SE1 6AN",
      street: "1 Bankside",
    });
    const prior = {
      version: 1 as const,
      standingRule: "listed" as const,
      venues: [{
        venueId: "crown-se1",
        name: "The Crown",
        postcode: "SE1 6AN",
        borough: "Southwark",
        seenOn: "2026-09-01",
        website: { url: "https://thecrown-bankside.co.uk/drinks", sourceUrl: "https://thecrown-bankside.co.uk/drinks", seenOn: "2026-09-01" },
        drinks: [{
          drink: "London Pride",
          size: "pint" as const,
          sizeDetail: "pint",
          priceGbp: 5.5,
          standing: "listed" as const,
          sourceUrl: "https://thecrown-bankside.co.uk/drinks",
          seenOn: "2026-09-01",
        }],
        excerpts: [{ sourceUrl: "https://thecrown-bankside.co.uk/drinks", excerpt: "London Pride £5.50 /pint", seenOn: "2026-09-01" }],
        candidates: [],
      }],
    };
    const cursor = { version: 1 as const, lastSeen: { "crown-se1": "2026-09-01" } };
    const errored = await runNightlyPass({
      venues: [pub],
      cursor,
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 10,
      staleAfterDays: 30,
      queue: prior,
      fetchImpl: async () => ({ error: "Too many requests", usage: { credits: 1 } }),
    });
    expect(errored.cursor.lastSeen["crown-se1"]).toBe("2026-09-01");
    expect(defined(errored.queue.venues[0]).drinks.map((row) => row.priceGbp)).toEqual([5.5]);
    const foodOnly = await runNightlyPass({
      venues: [pub],
      cursor,
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 10,
      staleAfterDays: 30,
      queue: prior,
      fetchImpl: async (request) => {
        if (request.kind === "search") {
          return {
            results: [{
              url: "https://thecrown-bankside.co.uk/food-menu.pdf",
              title: "The Crown",
              content: "The Crown, 1 Bankside, SE1 6AN.",
            }],
            usage: { credits: 1 },
          };
        }
        return {
          results: [{ url: "https://thecrown-bankside.co.uk/food-menu.pdf", raw_content: "Burger £12.00" }],
          usage: { credits: 1 },
        };
      },
    });
    expect(foodOnly.cursor.lastSeen["crown-se1"]).toBe("2026-10-01");
    expect(defined(foodOnly.queue.venues[0]).drinks.map((row) => row.priceGbp)).toEqual([5.5]);
    expect(defined(foodOnly.queue.venues[0]).excerpts.map((row) => row.excerpt).join("\n")).toContain("Burger £12.00");
  });

  it("does not mark a venue seen when the search spends the last credit and skips extract", async () => {
    const pub = venue({
      id: "crown-se1",
      name: "The Crown",
      postcode: "SE1 6AN",
      street: "1 Bankside",
    });
    const drinks = "https://thecrown-bankside.co.uk/drinks";
    const calls: string[] = [];
    const search = {
      results: [{
        url: drinks,
        title: "The Crown",
        content: "The Crown, 1 Bankside, SE1 6AN. London Pride £5.50 /pint",
      }],
      usage: { credits: 1 },
    };
    const skipped = await runNightlyPass({
      venues: [pub],
      cursor: { version: 1, lastSeen: {} },
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 1,
      staleAfterDays: 30,
      queue: listedQueue,
      fetchImpl: async (request) => {
        calls.push(request.kind);
        return search;
      },
    });
    expect(calls).toEqual(["search"]);
    expect(skipped.cursor.lastSeen["crown-se1"]).toBeUndefined();
    expect(skipped.queue.venues.flatMap((row) => row.drinks)).toEqual([]);
    const laterCalls: string[] = [];
    const later = await runNightlyPass({
      venues: [pub],
      cursor: skipped.cursor,
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 2,
      staleAfterDays: 30,
      queue: skipped.queue,
      fetchImpl: async (request) => {
        laterCalls.push(request.kind);
        if (request.kind === "search") return search;
        return { results: [{ url: drinks, raw_content: "London Pride £6.20 /pint" }], usage: { credits: 1 } };
      },
    });
    expect(laterCalls).toEqual(["search", "extract"]);
    expect(later.cursor.lastSeen["crown-se1"]).toBe("2026-10-01");
    expect(defined(later.queue.venues[0]).drinks.map((row) => row.priceGbp)).toEqual([6.2]);
  });

  it("keeps a measured snippet price when extract returns nothing and leaves the venue unseen", async () => {
    const pub = venue({
      id: "crown-se1",
      name: "The Crown",
      postcode: "SE1 6AN",
      street: "1 Bankside",
    });
    const drinks = "https://thecrown-bankside.co.uk/drinks";
    const search = {
      results: [{
        url: drinks,
        title: "The Crown",
        content: "The Crown, 1 Bankside, SE1 6AN. London Pride £5.50 /pint",
      }],
      usage: { credits: 1 },
    };
    const empty = await runNightlyPass({
      venues: [pub],
      cursor: { version: 1, lastSeen: {} },
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 2,
      staleAfterDays: 30,
      queue: listedQueue,
      fetchImpl: async (request) => {
        if (request.kind === "search") return search;
        return { results: [], usage: { credits: 1 } };
      },
    });
    expect(defined(empty.queue.venues[0]).drinks.map((row) => ({
      drink: row.drink,
      size: row.size,
      priceGbp: row.priceGbp,
    }))).toEqual([{ drink: "London Pride", size: "pint", priceGbp: 5.5 }]);
    expect(empty.cursor.lastSeen["crown-se1"]).toBeUndefined();
    const failed = await runNightlyPass({
      venues: [pub],
      cursor: { version: 1, lastSeen: {} },
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 2,
      staleAfterDays: 30,
      queue: listedQueue,
      fetchImpl: async (request) => {
        if (request.kind === "search") return search;
        return { error: "extract failed", usage: { credits: 1 } };
      },
    });
    expect(defined(failed.queue.venues[0]).drinks.map((row) => ({
      drink: row.drink,
      size: row.size,
      priceGbp: row.priceGbp,
    }))).toEqual([{ drink: "London Pride", size: "pint", priceGbp: 5.5 }]);
    expect(failed.cursor.lastSeen["crown-se1"]).toBeUndefined();
  });

  it("marks a bound homepage seen when there is no extract url", async () => {
    const pub = venue({
      id: "crown-se1",
      name: "The Crown",
      postcode: "SE1 6AN",
      street: "1 Bankside",
    });
    const calls: string[] = [];
    const result = await runNightlyPass({
      venues: [pub],
      cursor: { version: 1, lastSeen: {} },
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 2,
      staleAfterDays: 30,
      queue: listedQueue,
      fetchImpl: async (request) => {
        calls.push(request.kind);
        return {
          results: [{
            url: "https://thecrown-bankside.co.uk/",
            title: "The Crown",
            content: "The Crown, 1 Bankside, SE1 6AN. London Pride £5.50 /pint",
          }],
          usage: { credits: 1 },
        };
      },
    });
    expect(calls).toEqual(["search"]);
    expect(result.cursor.lastSeen["crown-se1"]).toBe("2026-10-01");
    expect(defined(result.queue.venues[0]).website?.url).toBe("https://thecrown-bankside.co.uk/");
    expect(defined(result.queue.venues[0]).drinks.map((row) => row.drink)).toEqual(["London Pride"]);
  });

  it("keeps a queued food line when a later page states the kitchen but prices no dish", async () => {
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
    expect(defined(first.queue.venues[0]).excerpts.map((row) => row.excerpt)).toEqual(["Burger £12.00"]);
    const kitchen = await night(oct1, first.queue, first.cursor, "Our kitchen\nLondon Pride £5.50 /pint");
    expect(defined(kitchen.queue.venues[0]).drinks.map((row) => row.drink)).toEqual(["London Pride"]);
    expect(defined(kitchen.queue.venues[0]).excerpts.map((row) => row.excerpt)).toContain("Burger £12.00");
    const closed = await night(
      new Date("2026-10-31T12:00:00.000Z"),
      kitchen.queue,
      kitchen.cursor,
      "The kitchen closed tonight.\nGuinness £5.80 /pint",
    );
    expect(defined(closed.queue.venues[0]).drinks.map((row) => row.drink).sort()).toEqual(["Guinness", "London Pride"]);
    expect(defined(closed.queue.venues[0]).excerpts.map((row) => row.excerpt)).toContain("Burger £12.00");
    const replaced = await night(
      new Date("2026-11-30T12:00:00.000Z"),
      closed.queue,
      closed.cursor,
      "Pie £9.00",
    );
    const kept = defined(replaced.queue.venues[0]).excerpts.map((row) => row.excerpt);
    expect(kept).toContain("Burger £12.00");
    expect(kept).toContain("Pie £9.00");
    expect(defined(replaced.queue.venues[0]).drinks.map((row) => row.drink).sort()).toEqual(["Guinness", "London Pride"]);
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
    expect(defined(first.queue.venues[0]).website).toBeNull();
    expect(defined(first.queue.venues[0]).candidates).toEqual(["https://thecrown.co.uk/drinks"]);
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
    expect(defined(later.queue.venues[0]).website).toBeNull();
    expect(defined(later.queue.venues[0]).candidates).toEqual(["https://thecrown.co.uk/drinks"]);
  });

  it("clears unbound candidate urls once a later night binds the venue site", async () => {
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
        results: [{ url: "https://thecrown.co.uk/drinks", title: "The Crown", content: "London Pride £5.50 /pint." }],
        usage: { credits: 1 },
      }),
    });
    expect(defined(first.queue.venues[0]).website).toBeNull();
    expect(defined(first.queue.venues[0]).candidates).toEqual(["https://thecrown.co.uk/drinks"]);
    const bound = await runNightlyPass({
      venues: [pub],
      cursor: first.cursor,
      usage: researcher,
      now: oct1,
      reserveCredits: 0,
      manualCap: 10,
      staleAfterDays: 30,
      queue: first.queue,
      fetchImpl: async (request) => {
        if (request.kind === "search") {
          return {
            results: [{
              url: "https://thecrown-bankside.co.uk/drinks",
              title: "The Crown",
              content: "The Crown, 1 Bankside, SE1 6AN.",
            }],
            usage: { credits: 1 },
          };
        }
        return {
          results: [{ url: "https://thecrown-bankside.co.uk/drinks", raw_content: "London Pride £6.10 /pint" }],
          usage: { credits: 1 },
        };
      },
    });
    expect(defined(bound.queue.venues[0]).website?.url).toBe("https://thecrown-bankside.co.uk/drinks");
    expect(defined(bound.queue.venues[0]).candidates).toEqual([]);
    expect(defined(bound.queue.venues[0]).drinks.map((row) => row.priceGbp)).toEqual([6.1]);
  });

  it("keeps earlier hours and phone lines when a later page does not restate them", async () => {
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
      "Monday 12pm to 11pm\nCall 020 7946 0991\nBeer garden out the back.\nThis pub is permanently closed.\nBurger £12.00",
    );
    const firstText = defined(first.queue.venues[0]).excerpts.map((row) => row.excerpt).join("\n");
    expect(firstText).toContain("Burger £12.00");
    expect(firstText).toContain("Beer garden out the back.");
    expect(firstText).toContain("This pub is permanently closed.");
    expect(firstText).toContain("Monday 12pm to 11pm");
    expect(firstText).toContain("020 7946 0991");
    expect(first.queue.venues[0]).not.toHaveProperty("hours");
    expect(first.queue.venues[0]).not.toHaveProperty("phone");
    const drinks = await night(oct1, first.queue, first.cursor, "London Pride £5.50 /pint");
    const kept = defined(drinks.queue.venues[0]).excerpts.map((row) => row.excerpt).join("\n");
    expect(defined(drinks.queue.venues[0]).drinks.map((row) => row.drink)).toEqual(["London Pride"]);
    expect(kept).toContain("Burger £12.00");
    expect(kept).toContain("Beer garden out the back.");
    expect(kept).toContain("This pub is permanently closed.");
    expect(kept).toContain("Monday 12pm to 11pm");
    expect(kept).toContain("020 7946 0991");
    const closed = await night(
      new Date("2026-10-31T12:00:00.000Z"),
      drinks.queue,
      drinks.cursor,
      "The kitchen closed tonight.\nGuinness £5.80 /pint",
    );
    expect(defined(closed.queue.venues[0]).drinks.map((row) => row.drink).sort()).toEqual(["Guinness", "London Pride"]);
    const closedText = defined(closed.queue.venues[0]).excerpts.map((row) => row.excerpt).join("\n");
    expect(closedText).toContain("Burger £12.00");
    expect(closedText).toContain("Monday 12pm to 11pm");
    expect(closedText).toContain("020 7946 0991");
    expect(closed.queue.venues[0]).not.toHaveProperty("hours");
    expect(closed.queue.venues[0]).not.toHaveProperty("phone");
  });

  it("keeps a bound page that is not a menu url, and does not price a food menu", async () => {
    const pub = venue({
      id: "crown-se1",
      name: "The Crown",
      postcode: "SE1 6AN",
      street: "1 Bankside",
    });
    const calls: string[] = [];
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
        calls.push(request.kind);
        if (request.kind === "search") {
          return {
            results: [
              {
                url: "https://thecrown-bankside.co.uk/",
                title: "The Crown",
                content: "The Crown, 1 Bankside, SE1 6AN. London Pride £5.50 /pint.",
              },
              { url: "https://thecrown-bankside.co.uk/food-menu.pdf", title: "Food", content: "" },
            ],
            usage: { credits: 1 },
          };
        }
        expect(request.urls).toEqual(["https://thecrown-bankside.co.uk/food-menu.pdf"]);
        return {
          results: [{ url: "https://thecrown-bankside.co.uk/food-menu.pdf", raw_content: "Scotch egg £6.50\nRum baba £7" }],
          usage: { credits: 1 },
        };
      },
    });
    expect(calls).toEqual(["search", "extract"]);
    expect(defined(result.queue.venues[0]).website?.url).toBe("https://thecrown-bankside.co.uk/");
    expect(defined(result.queue.venues[0]).drinks.map((row) => row.drink)).toEqual(["London Pride"]);
    const text = defined(result.queue.venues[0]).excerpts.map((row) => row.excerpt).join("\n");
    expect(text).toContain("London Pride £5.50");
    expect(text).toContain("Scotch egg £6.50");
    expect(text).toContain("Rum baba £7");
    expect(defined(result.queue.venues[0]).drinks.find((row) => /scotch|rum|baba/i.test(row.drink))).toBeUndefined();
  });

  it("keeps an earlier hours excerpt when a later page states another day", async () => {
    const pub = venue({
      id: "crown-se1",
      name: "The Crown",
      postcode: "SE1 6AN",
      street: "1 Bankside",
    });
    const drinks = "https://thecrown-bankside.co.uk/drinks";
    const beer = "https://thecrown-bankside.co.uk/beer";
    type Night = Awaited<ReturnType<typeof runNightlyPass>>;
    const night = (now: Date, queue: Night["queue"], cursor: Night["cursor"], bodies: Record<string, string>) =>
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
              results: [
                { url: drinks, title: "Drinks", content: "The Crown, 1 Bankside, SE1 6AN." },
                { url: beer, title: "Beer", content: "" },
              ],
              usage: { credits: 1 },
            };
          }
          return {
            results: request.urls.map((url: string) => ({ url, raw_content: bodies[url] ?? "" })),
            usage: { credits: 1 },
          };
        },
      });
    const first = await night(new Date("2026-09-01T12:00:00.000Z"), listedQueue, { version: 1, lastSeen: {} }, {
      [drinks]: "Monday 12pm to 11pm",
      [beer]: "Tuesday 12pm to 11pm",
    });
    const firstText = defined(first.queue.venues[0]).excerpts.map((row) => row.excerpt).join("\n");
    expect(firstText).toContain("Monday 12pm to 11pm");
    expect(firstText).toContain("Tuesday 12pm to 11pm");
    expect(first.queue.venues[0]).not.toHaveProperty("hours");
    const later = await night(oct1, first.queue, first.cursor, {
      [drinks]: "Sunday 12pm to 10pm",
      [beer]: "",
    });
    const laterText = defined(later.queue.venues[0]).excerpts.map((row) => row.excerpt).join("\n");
    expect(laterText).toContain("Monday 12pm to 11pm");
    expect(laterText).toContain("Tuesday 12pm to 11pm");
    expect(laterText).toContain("Sunday 12pm to 10pm");
    expect(later.queue.venues[0]).not.toHaveProperty("hours");
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

