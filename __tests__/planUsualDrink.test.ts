// What's our round here? (review item B6): the usual drink a crew member picks,
// the door that saves it, and the forecast the plan card prints from it.
//
// Three promises are held here. (1) The four choices are one closed set, in
// the leaf and in migration 0211's CHECK. (2) A member sets their own usual
// and nobody else's, through the member capability. (3) The forecast reads
// LISTED prices only, a wine figure is a stated 175 ml row and never a scaled
// one, and a drink with no figure says "not listed" rather than borrowing one.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { POST as CREATE } from "@/app/api/plans/route";
import { POST as USUAL_DRINK } from "@/app/api/plans/[id]/usual-drink/route";
import { defined } from "@/__tests__/helpers/defined";
import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import type { PlanState } from "@/lib/plan";
import { planReportLine } from "@/lib/planReportLine";
import {
  listedMenuDrinkFor,
  stopRound,
  stopRoundTotalLine,
} from "@/lib/planRoundForecast";
import { __resetMemoryPlans } from "@/lib/planStore";
import {
  cleanPlanUsualDrink,
  PLAN_USUAL_DRINK_LABEL,
  PLAN_USUAL_DRINK_MEASURE,
  PLAN_USUAL_DRINKS,
} from "@/lib/planUsualDrink";
import type { Venue } from "@/lib/venues";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20261031020000_0211_plan_crew_usual_drink.sql",
);
const ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20261031020000_0211_plan_crew_usual_drink_rollback.sql",
);

const NOW = Date.parse("2026-10-30T18:00:00.000Z");
const RECENT = "2026-10-03T12:00:00.000Z";
const LONG_AGO = "2024-01-03T12:00:00.000Z";

function menuRow(over: Partial<DrinkPriceUpdate> & { priceGbp: number }): DrinkPriceUpdate {
  return {
    venueKey: "venue-1",
    drinkName: "House white",
    category: "wine",
    source: { label: "The pub's menu", url: "https://example.com/menu", licence: "publisher" },
    observedAt: RECENT,
    lane: "publisher",
    ...over,
  };
}

function venue(over: Record<string, unknown> = {}): Venue {
  return {
    id: "venue-1",
    kind: "pub",
    cheapestPrice: null,
    prices: [],
    ...over,
  } as unknown as Venue;
}

describe("the closed usual-drink set", () => {
  it("is beer, wine, alcohol-free and soft, and names its serving where it has one", () => {
    expect([...PLAN_USUAL_DRINKS]).toEqual(["beer", "wine", "alcohol_free", "soft"]);
    expect(PLAN_USUAL_DRINK_MEASURE.beer).toBe("pint");
    expect(PLAN_USUAL_DRINK_MEASURE.wine).toBe("175ml");
    expect(PLAN_USUAL_DRINK_LABEL.wine).toBe("Wine (175 ml)");
    expect(PLAN_USUAL_DRINK_LABEL.alcohol_free).toBe("Alcohol-free");
    expect(cleanPlanUsualDrink("cider")).toBe(null);
    expect(cleanPlanUsualDrink(undefined)).toBe(null);
  });

  it("is the same list as migration 0211's CHECK, and the rollback drops the column", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const check = /usual_drink in \(([^)]*)\)/i.exec(sql);
    expect(check).not.toBe(null);
    const words = (check?.[1] ?? "").split(",").map((word) => word.trim().replace(/'/g, ""));
    expect(words).toEqual([...PLAN_USUAL_DRINKS]);
    expect(sql).not.toMatch(/^\s*grant\s/im);
    expect(readFileSync(ROLLBACK, "utf8")).toMatch(/drop column if exists usual_drink/i);
  });
});

describe("POST /api/plans/[id]/usual-drink", () => {
  const URL = "http://localhost/api/plans";
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function createPlan() {
    const response = await CREATE(new Request(URL, {
      method: "POST",
      headers: { "idempotency-key": `usual-drink-${crypto.randomUUID()}` },
      body: JSON.stringify({
        title: "Friday near Bank",
        startTime: "2026-11-06T19:00:00.000Z",
        creatorName: "Karan",
        stops: [{ venueId: "venue-xjf3n0", venueName: "First" }],
      }),
    }));
    return await response.json() as { plan: PlanState; memberToken: string };
  }

  beforeEach(() => {
    __resetMemoryPlans();
  });

  it("saves the member's own pick and returns it on their seat", async () => {
    const created = await createPlan();
    const id = created.plan.plan.id;
    const response = await USUAL_DRINK(new Request(`${URL}/${id}/usual-drink`, {
      method: "POST",
      body: JSON.stringify({ memberToken: created.memberToken, usualDrink: "wine" }),
    }), ctx(id));
    expect(response.status).toBe(200);
    const plan = await response.json() as PlanState;
    expect(defined(plan.crew[0]).usualDrink).toBe("wine");
  });

  it("refuses a bearer with no seat, and a word off the list, and writes nothing", async () => {
    const created = await createPlan();
    const id = created.plan.plan.id;
    const stranger = await USUAL_DRINK(new Request(`${URL}/${id}/usual-drink`, {
      method: "POST",
      body: JSON.stringify({ memberToken: "not-a-seat", usualDrink: "beer" }),
    }), ctx(id));
    expect(stranger.status).toBe(403);
    const offList = await USUAL_DRINK(new Request(`${URL}/${id}/usual-drink`, {
      method: "POST",
      body: JSON.stringify({ memberToken: created.memberToken, usualDrink: "cider" }),
    }), ctx(id));
    expect(offList.status).toBe(400);
    const anonymous = await USUAL_DRINK(new Request(`${URL}/${id}/usual-drink`, {
      method: "POST",
      body: JSON.stringify({ usualDrink: "beer" }),
    }), ctx(id));
    expect(anonymous.status).toBe(400);
  });
});

describe("the round forecast", () => {
  const crew = [
    { id: "m1", name: "Sam", usualDrink: "beer" as const },
    { id: "m2", name: "Ali", usualDrink: "wine" as const },
    { id: "m3", name: "Jo", usualDrink: "soft" as const },
    { id: "m4", name: "Viv" },
  ];

  it("reads a listed pint and a stated 175 ml glass, says not listed for the rest, and totals what it read", () => {
    const pub = venue({
      cheapestPrice: 5.4,
      bundlePrices: { listed: { priceGbp: 5.4, sourceUrl: "https://example.com", observedAt: RECENT } },
      priceUpdates: { drink: [menuRow({ priceGbp: 7.5, servingSize: "175ml" })], food: [] },
    });
    const round = stopRound(pub, crew, NOW);
    // Viv has not picked, so Viv is not in the round.
    expect(round.drinkCount).toBe(3);
    expect(round.listedCount).toBe(2);
    expect(round.lines.map((line) => line.price?.priceGbp ?? null)).toEqual([5.4, 7.5, null]);
    expect(stopRoundTotalLine(round)).toBe("£12.90 for 2 of 3 drinks listed");
  });

  it("never reads a glass of another size, or a row with no stated size, as 175 ml", () => {
    const rows = [
      menuRow({ priceGbp: 10.5, servingSize: "250ml" }),
      menuRow({ priceGbp: 30, servingSize: "Bottle" }),
      menuRow({ priceGbp: 6 }),
      menuRow({ priceGbp: 6.2, servingSize: "Large glass" }),
    ];
    expect(listedMenuDrinkFor(rows, "wine", NOW)).toBe(null);
  });

  it("takes the cheapest stated 175 ml row, and drops demo and year-old rows", () => {
    const rows = [
      menuRow({ priceGbp: 4, servingSize: "175 ml", lane: "demo" }),
      menuRow({ priceGbp: 5, servingSize: "175ml", observedAt: LONG_AGO }),
      menuRow({ priceGbp: 8.2, servingSize: "175ml" }),
      menuRow({ priceGbp: 7.9, servingSize: "175 ml" }),
    ];
    expect(listedMenuDrinkFor(rows, "wine", NOW)?.priceGbp).toBe(7.9);
  });

  it("prints the row's own name for a kind-only choice", () => {
    const rows = [menuRow({ priceGbp: 5.2, category: "alcohol-free", drinkName: "Lucky Saint" })];
    expect(listedMenuDrinkFor(rows, "alcohol_free", NOW)?.drinkName).toBe("Lucky Saint");
  });

  it("does not print a modelled pint as a listed one", () => {
    const pub = venue({
      bundlePrices: { estimate: { priceGbp: 5.9, basis: "borough median", sampleSize: 12, computedAt: RECENT } },
    });
    expect(defined(stopRound(pub, crew, NOW).lines[0]).price).toBe(null);
  });

  it("says nothing it did not read while a stop's detail has not answered", () => {
    const round = stopRound(null, crew, NOW);
    expect(round.listedCount).toBe(0);
    expect(stopRoundTotalLine(round)).toBe(null);
  });
});

describe("the planner report line", () => {
  it("joins the lines that answer a word the reader set, in order", () => {
    const line = planReportLine({
      hardConstraints: [
        { code: "safety", status: "satisfied", message: "Stops with an active reviewed avoid signal were excluded." },
        { code: "tube_stations", status: "satisfied", message: "Tube: every stop is within 600 m of a station." },
        { code: "short_walks", status: "satisfied", message: "Short walks: every leg is under 1.2 km." },
      ],
    });
    expect(line).toBe("Short walks: every leg is under 1.2 km. Tube: every stop is within 600 m of a station.");
  });

  it("prints nothing when the response carries none of those lines", () => {
    expect(planReportLine({ hardConstraints: [{ code: "safety", status: "satisfied", message: "x" }] })).toBe(null);
    expect(planReportLine(undefined)).toBe(null);
  });
});
