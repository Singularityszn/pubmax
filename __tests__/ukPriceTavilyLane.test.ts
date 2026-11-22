import { describe, expect, it, vi } from "vitest";

import { defined } from "@/__tests__/helpers/defined";
import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";
import {
  createCreditBudget,
  discoveredSiteFor,
  harvestPubBatch,
  type CreditBudget,
  type SnapshotPub,
  type TavilyLaneDeps,
  type TavilyLaneTarget,
} from "../scripts/harvest/uk-prices/tavilyLane.mjs";

const MENU = [
  "# Drinks",
  "## On draught",
  "- Camden Hells, pint £6.20",
  "- Guinness, pint £6.40",
  "## Wine",
  "- House Merlot 175ml £7.50",
  "## Soft drinks",
  "- Coca-Cola 330ml £3.20",
  "- Fever-Tree Lemonade 200ml £2.90",
].join("\n");

const HOME = "# The Feathers\n\nWelcome. [Our drinks](/drinks) [Find us](/contact)\n\nOpen every day.";

const PUB: SnapshotPub = {
  osmId: "node/1",
  name: "The Feathers",
  postcode: "SE1 9AA",
  address: "12, Union Street, SE1 9AA",
  lat: 51.5,
  lng: -0.1,
  website: "https://thefeathers.co.uk/",
};

type Page = { url: string; markdown: string };

function fakeDeps(pages: Record<string, string>, overrides: Record<string, unknown> = {}) {
  const extract = vi.fn(async (urls: string[]) => {
    const read: Page[] = [];
    const failed: Array<{ url: string; error: string }> = [];
    for (const url of urls) {
      if (url in pages) read.push({ url, markdown: pages[url] ?? "" });
      else failed.push({ url, error: "not found" });
    }
    return { pages: read, failed, credits: 0 };
  });
  return {
    robots: vi.fn(async () => ({ allowed: true, robots: "rules-file", evidence: "" })),
    extract,
    search: vi.fn(async () => ({ results: [], credits: 1 })),
    render: null as null | ((url: string) => Promise<{ markdown: string; links: string[]; finalUrl: string }>),
    renderBudget: { take: () => true },
    readPrices: async (markdown: string) => ({ reading: readVenueDrinkPrices(markdown, "text") }),
    ...overrides,
  };
}

const target = (pub: SnapshotPub = PUB, extra: Partial<TavilyLaneTarget> = {}): TavilyLaneTarget => ({
  pub,
  venueId: "venue-uk-n1",
  siteUrl: pub.website ?? null,
  pubsOnHost: 1,
  ...extra,
});

async function first(targets: TavilyLaneTarget[], deps: TavilyLaneDeps, budget: CreditBudget) {
  return defined((await harvestPubBatch(targets, deps, budget))[0]);
}

describe("the Tavily price lane", () => {
  it("reads every drink a pub's own drinks page states, as listed rows with their page", async () => {
    const deps = fakeDeps({
      "https://thefeathers.co.uk/": HOME,
      "https://thefeathers.co.uk/drinks": MENU,
    });
    const budget = createCreditBudget(10);
    const outcome = await first([target()], deps, budget);

    expect(outcome.outcome).toBe("priced");
    expect(new Set(outcome.rows.map((row: { category: string }) => row.category))).toEqual(
      new Set(["beer", "wine", "soft-drink"]),
    );
    for (const row of outcome.rows) {
      expect(row.url).toBe("https://thefeathers.co.uk/drinks");
      expect(row.renderer).toBe("tavily");
    }
    expect(budget.spent).toBeCloseTo(0.4);
  });

  it("asks robots before Tavily, and a refusal reads nothing", async () => {
    const deps = fakeDeps(
      { "https://thefeathers.co.uk/": HOME },
      {
        robots: vi.fn(async () => ({
          allowed: false,
          reason: "robots-disallowed",
          robots: "rules-file",
          evidence: "Disallow: /",
        })),
      },
    );
    const outcome = await first([target()], deps, createCreditBudget(10));

    expect(outcome.outcome).toBe("robots-disallowed");
    expect(outcome.refusals).toEqual([
      expect.objectContaining({ url: "https://thefeathers.co.uk/", reason: "robots-disallowed" }),
    ]);
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it("never sends a refused estate host to Tavily", async () => {
    const refused: SnapshotPub = { ...PUB, website: "https://www.stonegategroup.co.uk/pubs/the-feathers" };
    const deps = fakeDeps({});
    const outcome = await first([target(refused)], deps, createCreditBudget(10));

    expect(outcome.outcome).toBe("policy-refused-host");
    expect(deps.robots).not.toHaveBeenCalled();
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it("stops at the credit budget without a provider call", async () => {
    const deps = fakeDeps({ "https://thefeathers.co.uk/": HOME });
    const outcome = await first([target()], deps, createCreditBudget(0));

    expect(outcome.outcome).toBe("budget-spent");
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it("does not let an estate page price a pub it does not name", async () => {
    const deps = fakeDeps({
      "https://thefeathers.co.uk/": HOME,
      "https://thefeathers.co.uk/drinks": MENU,
    });
    const outcome = await first([target(PUB, { pubsOnHost: 4 })], deps, createCreditBudget(10));

    expect(outcome.outcome).toBe("estate-page-names-no-pub");
    expect(outcome.rows).toEqual([]);
  });
});

describe("finding a pub's drinks page", () => {
  const bareHome = "# The Feathers\n\nWelcome. Open every day.";

  it("takes the drinks links from the page's own HTML when Tavily's markdown drops them", async () => {
    const siteLinks = vi.fn(async () => ({ menu: ["https://thefeathers.co.uk/our-drinks"], contact: [] }));
    const deps = fakeDeps(
      { "https://thefeathers.co.uk/": bareHome, "https://thefeathers.co.uk/our-drinks": MENU },
      { siteLinks },
    );
    const outcome = await first([target()], deps, createCreditBudget(10));

    expect(outcome.outcome).toBe("priced");
    expect(outcome.searches).toBe(0);
    expect(deps.extract).toHaveBeenCalledTimes(1);
  });

  it("asks Tavily which page of the site states prices only when the site links none", async () => {
    const siteSearch = vi.fn(async () => ({
      results: [
        { url: "https://thefeathers.co.uk/whats-on", title: "", content: "Quiz night" },
        { url: "https://elsewhere.co.uk/menu", title: "", content: "£5" },
        { url: "https://thefeathers.co.uk/our-bar", title: "", content: "Guinness £6.40" },
      ],
      credits: 1,
    }));
    const deps = fakeDeps(
      { "https://thefeathers.co.uk/": bareHome, "https://thefeathers.co.uk/our-bar": MENU },
      { siteSearch },
    );
    const budget = createCreditBudget(10);
    const outcome = await first([target()], deps, budget);

    expect(siteSearch).toHaveBeenCalledWith("thefeathers.co.uk", "The Feathers");
    expect(outcome.outcome).toBe("priced");
    expect(defined(outcome.rows[0]).url).toBe("https://thefeathers.co.uk/our-bar");
    expect(budget.spent).toBeCloseTo(1.4);
  });
});

describe("a PDF drinks list", () => {
  it("is read through its own text layer, never through Tavily", async () => {
    const readPdf = vi.fn(async (url: string) => ({ text: MENU, finalUrl: url }));
    const siteLinks = vi.fn(async () => ({ menu: ["https://thefeathers.co.uk/files/drinks.pdf"], contact: [] }));
    const deps = fakeDeps({ "https://thefeathers.co.uk/": HOME.replace("[Our drinks](/drinks) ", "") }, { readPdf, siteLinks });
    const outcome = await first([target()], deps, createCreditBudget(10));

    expect(outcome.outcome).toBe("priced");
    expect(outcome.rows.every((row: { renderer: string }) => row.renderer === "pdf-text")).toBe(true);
    for (const call of deps.extract.mock.calls) expect(call[0]).not.toContain("https://thefeathers.co.uk/files/drinks.pdf");
  });
});

describe("finding a pub's site with Tavily search", () => {
  const unlisted: SnapshotPub = { ...PUB, website: null };

  it("refuses a directory, a chain estate and another pub's site, however well they state the address", () => {
    const results = [
      { url: "https://www.tripadvisor.co.uk/feathers", title: "", content: "SE1 9AA" },
      { url: "https://www.localpubguide-se1.co.uk/the-feathers", title: "", content: "SE1 9AA" },
      { url: "https://www.jdwetherspoon.com/pubs/the-feathers", title: "", content: "SE1 9AA" },
      { url: "https://feathersbar.co.uk/", title: "", content: "SE1 9AA" },
    ];
    const found = discoveredSiteFor(unlisted, results, {
      stateOwner: (host: string) => (host === "feathersbar.co.uk" ? "node/99" : null),
    });

    expect(found).toMatchObject({ refusal: "no-site-found" });
  });

  it("prices a found site only when a page on it states the pub's postcode", async () => {
    const search = vi.fn(async () => ({
      results: [{ url: "https://feathers-se1.co.uk/", title: "The Feathers", content: "" }],
      credits: 1,
    }));
    const unbound = fakeDeps(
      {
        "https://feathers-se1.co.uk/": HOME.replace("/contact", "/visit"),
        "https://feathers-se1.co.uk/drinks": MENU,
        "https://feathers-se1.co.uk/visit": "Find us at 1 Other Road, LS1 1AA",
      },
      { search },
    );
    const namesake = await first([target(unlisted)], unbound, createCreditBudget(10));
    expect(namesake.outcome).toBe("site-unbound");
    expect(namesake.rows).toEqual([]);

    const bound = fakeDeps(
      {
        "https://feathers-se1.co.uk/": HOME,
        "https://feathers-se1.co.uk/drinks": MENU,
        "https://feathers-se1.co.uk/contact": "The Feathers, 12 Union Street, London SE1 9AA",
      },
      { search },
    );
    const own = await first([target(unlisted)], bound, createCreditBudget(10));
    expect(own.outcome).toBe("priced");
    expect(own.discovered).toBe(true);
    expect(own.searches).toBe(1);
  });
});

describe("rendering a page Tavily read empty", () => {
  it("renders a drinks page that states no price, and never a page Tavily could not read", async () => {
    const render = vi.fn(async (url: string) => ({ markdown: MENU, links: [], finalUrl: url }));
    const deps = fakeDeps(
      {
        "https://thefeathers.co.uk/": "# The Feathers\n\n[Drinks](/drinks) [Wine list](/wine-list)",
        "https://thefeathers.co.uk/drinks": "Loading menu...",
      },
      { render },
    );
    const outcome = await first([target()], deps, createCreditBudget(10));

    expect(render).toHaveBeenCalledWith("https://thefeathers.co.uk/drinks");
    expect(render).not.toHaveBeenCalledWith("https://thefeathers.co.uk/wine-list");
    expect(outcome.outcome).toBe("priced");
    expect(outcome.rows.every((row: { renderer: string }) => row.renderer === "browserbase")).toBe(true);
  });

  it("drops a rendered challenge page", async () => {
    const render = vi.fn(async (url: string) => ({
      markdown: "Just a moment... cf-browser-verification challenge-platform",
      links: [],
      finalUrl: url,
    }));
    const deps = fakeDeps(
      {
        "https://thefeathers.co.uk/": "# The Feathers\n\n[Drinks](/drinks)",
        "https://thefeathers.co.uk/drinks": "Loading menu...",
      },
      { render },
    );
    const outcome = await first([target()], deps, createCreditBudget(10));

    expect(outcome.outcome).toBe("menu-states-no-price");
    expect(outcome.refusals).toContainEqual(expect.objectContaining({ reason: "blocked-by-challenge" }));
  });
});
