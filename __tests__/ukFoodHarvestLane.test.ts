import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createRobotsChecker } from "@/lib/harvest/robots";
import {
  FIRST_PARTY_FOOD_LICENCE,
  groupFoodTargetsByHost,
  harvestFood,
  type FoodHarvestDeps,
  type FoodHarvestResult,
  type FoodLedgerRow,
} from "../scripts/harvest/uk-food/lane.mjs";

const FIXTURES = path.join(__dirname, "fixtures", "uk-food");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");
const MENU = fixture("served-menu.html");
const RENDERED = fixture("rendered-menu.md");
const HOME = fixture("home.html");
const NOW = new Date("2026-10-17T12:00:00.000Z");

type Page = { status?: number; body: string | Uint8Array; contentType?: string; landedOn?: string };

/** A served web: robots files and pages by URL. Every request is recorded. */
function servedWeb(pages: Record<string, Page>, robots: Record<string, { status: number; body: string }> = {}) {
  const requested: string[] = [];
  const robotsFetch = vi.fn(async (url: string) => {
    const origin = new URL(url).origin;
    const answer = robots[origin] ?? { status: 404, body: "" };
    return new Response(answer.body, { status: answer.status, headers: { "content-type": "text/plain" } });
  });
  const fetchServed = vi.fn(async (url: string) => {
    requested.push(url);
    const page = pages[url];
    if (!page) return { ok: false, status: 404, url, contentType: "text/html", body: "" };
    const status = page.status ?? 200;
    return { ok: status < 400, status, url: page.landedOn ?? url, contentType: page.contentType ?? "text/html", body: page.body };
  });
  const deps: FoodHarvestDeps = {
    robots: createRobotsChecker({ fetchImpl: robotsFetch as unknown as typeof fetch }),
    fetchServed,
    readPdf: vi.fn(async () => null),
    renderMode: "auto",
    now: () => NOW,
    sleep: async () => {},
    delayMs: 0,
  };
  return { requested, deps };
}

/** One host's ledger row, which the run must have written. */
function hostRow(result: FoodHarvestResult, host: string): FoodLedgerRow {
  const row = result.ledger[host];
  expect(row, host).toBeDefined();
  return row as FoodLedgerRow;
}

const curatedPub = (venueId: string, menuUrl: string, name = "The Example Arms") => ({
  venueId,
  venueKey: venueId,
  name,
  menuUrls: [menuUrl],
});

describe("harvestFood: a curated pub's own menu page", () => {
  it("publishes each dish keyed by the curated venue, with its page, date and licence", async () => {
    const menuUrl = "https://www.example-arms.test/food/";
    const web = servedWeb({ [menuUrl]: { body: MENU } });
    const result = await harvestFood(groupFoodTargetsByHost([curatedPub("venue-arms", menuUrl)]), web.deps);

    expect(hostRow(result, "example-arms.test")).toMatchObject({ outcome: "priced", pagesRead: 1, rows: 11 });
    expect(result.rows).toHaveLength(11);
    expect(result.rows[0]).toEqual({
      venueKey: "venue-arms",
      venueId: "venue-arms",
      itemName: "Soup of the Day",
      category: "starters",
      priceGbp: 6.5,
      source: { label: "example-arms.test — the pub's own website", url: menuUrl, licence: FIRST_PARTY_FOOD_LICENCE },
      observedAt: NOW.toISOString(),
      readVia: "served",
      quote: "Soup of the Day / With crusty bread and butter. / £6.50",
    });
    expect(result.summary).toMatchObject({ rows: 11, venuesPriced: 1 });
  });

  it("asks robots about the PATH, and a disallowed menu path is never fetched", async () => {
    const menuUrl = "https://www.example-arms.test/food/";
    const web = servedWeb(
      { [menuUrl]: { body: MENU } },
      { "https://www.example-arms.test": { status: 200, body: "User-agent: *\nDisallow: /food/\n" } },
    );
    const result = await harvestFood(groupFoodTargetsByHost([curatedPub("venue-arms", menuUrl)]), web.deps);
    expect(result.rows).toEqual([]);
    expect(hostRow(result, "example-arms.test").outcome).toBe("robots-disallowed");
    expect(web.requested).toEqual([]);
  });

  it("treats an unreadable robots file as a refusal and reads nothing on that host", async () => {
    const menuUrl = "https://www.example-arms.test/food/";
    const web = servedWeb(
      { [menuUrl]: { body: MENU } },
      { "https://www.example-arms.test": { status: 403, body: "Forbidden" } },
    );
    const result = await harvestFood(groupFoodTargetsByHost([curatedPub("venue-arms", menuUrl)]), web.deps);
    expect(hostRow(result, "example-arms.test").outcome).toBe("robots-unreadable");
    expect(web.requested).toEqual([]);
  });

  it("refuses a page that redirected onto a host the fence refuses, and keeps nothing from it", async () => {
    const menuUrl = "https://www.example-arms.test/food/";
    const web = servedWeb({ [menuUrl]: { body: MENU, landedOn: "http://127.0.0.1/food/" } });
    const result = await harvestFood(groupFoodTargetsByHost([curatedPub("venue-arms", menuUrl)]), web.deps);
    expect(result.rows).toEqual([]);
    expect(hostRow(result, "example-arms.test").pages?.[0]).toMatchObject({ outcome: "refused-by-policy", landedOn: "http://127.0.0.1/food/" });
  });

  it("never requests a URL the fence refuses in the first place", async () => {
    const web = servedWeb({});
    const result = await harvestFood(groupFoodTargetsByHost([curatedPub("venue-local", "http://localhost/food/")]), web.deps);
    expect(hostRow(result, "localhost").outcome).toBe("refused-by-policy");
    expect(web.requested).toEqual([]);
  });
});

describe("harvestFood: rendering", () => {
  const menuUrl = "https://www.example-tavern.test/menu/";
  const shell = "<html><body><div id=app>Content is loading...</div></body></html>";

  it("renders only when the served document states no menu, and says it did", async () => {
    const web = servedWeb({ [menuUrl]: { body: shell } });
    const renderPage = vi.fn(async (url: string) => ({ markdown: RENDERED, links: [], finalUrl: url }));
    const result = await harvestFood(groupFoodTargetsByHost([curatedPub("venue-tavern", menuUrl, "The Example Tavern")]), {
      ...web.deps,
      renderPage,
    });
    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(6);
    expect(new Set(result.rows.map((row) => row.readVia))).toEqual(new Set(["rendered"]));
    expect(result.summary.renders).toBe(1);
  });

  it("does not render a page the served document already priced", async () => {
    const web = servedWeb({ [menuUrl]: { body: MENU } });
    const renderPage = vi.fn();
    await harvestFood(groupFoodTargetsByHost([curatedPub("venue-tavern", menuUrl)]), { ...web.deps, renderPage });
    expect(renderPage).not.toHaveBeenCalled();
  });

  it("spends no browser session past the render budget, or with rendering off", async () => {
    const web = servedWeb({ [menuUrl]: { body: shell } });
    const renderPage = vi.fn(async (url: string) => ({ markdown: RENDERED, links: [], finalUrl: url }));
    const targets = groupFoodTargetsByHost([curatedPub("venue-tavern", menuUrl)]);

    const capped = await harvestFood(targets, { ...web.deps, renderPage, renderBudget: 0 });
    expect(renderPage).not.toHaveBeenCalled();
    expect(capped.rows).toEqual([]);
    expect(capped.summary.rendersSkippedOverBudget).toBe(1);

    const off = await harvestFood(targets, { ...web.deps, renderPage, renderMode: "never" });
    expect(renderPage).not.toHaveBeenCalled();
    expect(hostRow(off, "example-tavern.test").outcome).toBe("no-menu-found");
  });

  it("checks the landing of a rendered page too", async () => {
    const web = servedWeb({ [menuUrl]: { body: shell } });
    const renderPage = vi.fn(async () => ({ markdown: RENDERED, links: [], finalUrl: "http://169.254.169.254/menu" }));
    const result = await harvestFood(groupFoodTargetsByHost([curatedPub("venue-tavern", menuUrl)]), { ...web.deps, renderPage });
    expect(result.rows).toEqual([]);
    expect(hostRow(result, "example-tavern.test").pages?.[0]?.outcome).toBe("refused-by-policy");
  });
});

describe("harvestFood: a pub that only states its website", () => {
  it("finds the food menu from the home page and follows nothing it should not", async () => {
    const origin = "https://www.example-arms.test";
    const web = servedWeb({ [`${origin}/`]: { body: HOME }, [`${origin}/food/`]: { body: MENU } });
    const result = await harvestFood(
      groupFoodTargetsByHost([{ venueId: "venue-uk-n1", venueKey: "venue-uk-n1", name: "The Example Arms", website: `${origin}/`, menuUrls: [] }]),
      web.deps,
    );
    expect(web.requested).toEqual([`${origin}/`, `${origin}/food/`, `${origin}/menus/sunday-lunch.pdf`]);
    expect(result.rows.every((row) => row.source.url === `${origin}/food/`)).toBe(true);
    expect(result.rows).toHaveLength(11);
  });

  it("on an estate host, gives a page only to the pub its path names", async () => {
    const origin = "https://www.example-estate.test";
    const web = servedWeb({
      [`${origin}/`]: { body: '<a href="/pubs/the-crown/food/">Crown food</a><a href="/food/">All food</a>' },
      [`${origin}/pubs/the-crown/food/`]: { body: MENU },
      [`${origin}/food/`]: { body: MENU },
    });
    const pubs = [
      { venueId: "venue-uk-n2", venueKey: "venue-uk-n2", name: "The Crown", website: `${origin}/`, menuUrls: [] },
      { venueId: "venue-uk-n3", venueKey: "venue-uk-n3", name: "The Anchor", website: `${origin}/`, menuUrls: [] },
    ];
    const result = await harvestFood(groupFoodTargetsByHost(pubs), web.deps);
    expect(new Set(result.rows.map((row) => row.venueKey))).toEqual(new Set(["venue-uk-n2"]));
    const pages = hostRow(result, "example-estate.test").pages ?? [];
    expect(pages.find((page) => page.url === `${origin}/food/`)?.outcome).toBe("estate-page-names-no-pub");
  });
});

describe("harvestFood: budgets and PDFs", () => {
  it("stops at the page budget and records the hosts it never reached", async () => {
    const a = "https://www.example-a.test/food/";
    const b = "https://www.example-b.test/food/";
    const web = servedWeb({ [a]: { body: MENU }, [b]: { body: MENU } });
    const result = await harvestFood(
      groupFoodTargetsByHost([curatedPub("venue-a", a), curatedPub("venue-b", b)]),
      { ...web.deps, pageBudget: 1 },
    );
    expect(hostRow(result, "example-a.test").outcome).toBe("priced");
    expect(hostRow(result, "example-b.test").outcome).toBe("budget-exhausted");
    expect(web.requested).toEqual([a]);
  });

  it("reads a PDF menu through its text layer, and counts one with none", async () => {
    const pdfUrl = "https://www.example-arms.test/menus/food.pdf";
    const web = servedWeb({ [pdfUrl]: { body: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf" } });
    const readPdf = vi.fn(async () => "Mains\nFish Pie £15.00\nSteak Pie £16.00\nBangers and Mash £14.00\nGammon and Eggs £15.50");
    const read = await harvestFood(groupFoodTargetsByHost([curatedPub("venue-arms", pdfUrl)]), { ...web.deps, readPdf });
    expect(read.rows.map((row) => `${row.readVia}|${row.itemName}`)).toEqual([
      "pdf|Fish Pie",
      "pdf|Steak Pie",
      "pdf|Bangers and Mash",
      "pdf|Gammon and Eggs",
    ]);

    const unread = await harvestFood(groupFoodTargetsByHost([curatedPub("venue-arms", pdfUrl)]), web.deps);
    expect(unread.rows).toEqual([]);
    expect(unread.summary.pdfUnread).toBe(1);
  });
});
