import { describe, expect, it, vi } from "vitest";

import { defined } from "@/__tests__/helpers/defined";
import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";
import {
  createCreditBudget,
  discoveredSiteFor,
  harvestPubBatch,
  siteLinksFromPage,
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

const SITE = "https://thefeathers.co.uk/";

const PUB: SnapshotPub = {
  osmId: "node/1",
  name: "The Feathers",
  postcode: "SE1 9AA",
  address: "12, Union Street, SE1 9AA",
  lat: 51.5,
  lng: -0.1,
  website: SITE,
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
    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).toContain("https://thefeathers.co.uk/our-drinks");
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

    expect(outcome.outcome).toBe("blocked-by-challenge");
    expect(outcome.refusals).toContainEqual(expect.objectContaining({ reason: "blocked-by-challenge" }));
  });
});


describe("permission and acquisition boundaries", () => {
  it.each([
    "https://www.tripadvisor.co.uk/Restaurant_Review-feathers",
    "https://whatpub.com/pubs/1/feathers",
    "https://camra.org.uk/pubs/feathers",
    "https://sub.untappd.com/feathers",
    "https://www.tripadvisor.com./feathers",
  ])("refuses the stated third-party website %s before any read", async (website) => {
    const siteLinks = vi.fn(async () => ({ menu: [], contact: [] }));
    const deps = fakeDeps({ [website]: MENU }, { siteLinks });
    const outcome = await first([target({ ...PUB, website })], deps, createCreditBudget(10));
    expect(outcome.outcome).toBe("policy-refused-host");
    expect(outcome.rows).toEqual([]);
    expect(siteLinks).not.toHaveBeenCalled();
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it.each(["https://thefeathers.co.uk/private/menu", "https://thefeathers.co.uk/Drinks", "https://elsewhere.co.uk/drinks"])(
    "refuses a rendered landing at %s", async (finalUrl) => {
      const deps = fakeDeps({
        "https://thefeathers.co.uk/": HOME,
        "https://thefeathers.co.uk/drinks": "Loading menu...",
      }, { render: async () => ({ markdown: MENU, links: [], finalUrl }) });
      const outcome = await first([target()], deps, createCreditBudget(10));
      expect(outcome.rows).toEqual([]);
      expect(outcome.refusals).toContainEqual(expect.objectContaining({ reason: "redirect-refused", url: finalUrl }));
    },
  );

  it("accepts www and trailing-slash landings only after checking their robots rules", async () => {
    const finalUrl = "https://www.thefeathers.co.uk/drinks/";
    const deps = fakeDeps({ "https://thefeathers.co.uk/": HOME }, {
      extract: async (urls: string[]) => ({
        pages: urls.map((url) => ({ url: url.endsWith("/drinks") ? finalUrl : url, markdown: url.endsWith("/drinks") ? MENU : HOME })),
        failed: [], credits: 0,
      }),
    });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.outcome).toBe("priced");
    expect(outcome.rows.every((row) => row.url === finalUrl)).toBe(true);
    expect(deps.robots).toHaveBeenCalledWith(finalUrl);

    const denied = fakeDeps({}, {
      ...deps,
      robots: async (url: string) => ({ allowed: url !== finalUrl, reason: "robots-disallowed" }),
    });
    const refused = await first([target()], denied, createCreditBudget(10));
    expect(refused.rows).toEqual([]);
    expect(refused.refusals).toContainEqual(expect.objectContaining({ reason: "robots-disallowed", url: finalUrl }));
  });

  it("does not price an unexpected Tavily landing", async () => {
    const deps = fakeDeps({}, {
      extract: async () => ({ pages: [{ url: "https://thefeathers.co.uk/private/menu", markdown: MENU }], failed: [], credits: 0.2 }),
    });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.rows).toEqual([]);
    expect(outcome.pagesRead).toBe(0);
  });

  it("refuses a PDF landing whose robots rules disallow it", async () => {
    const deps = fakeDeps({ "https://thefeathers.co.uk/": "[Drinks](/drinks.pdf)" }, {
      readPdf: async () => ({ text: MENU, finalUrl: "https://thefeathers.co.uk/private/drinks.pdf" }),
      robots: async (url: string) => ({ allowed: !url.includes("/private/"), reason: "robots-disallowed" }),
    });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.rows).toEqual([]);
    expect(outcome.refusals).toContainEqual(expect.objectContaining({ reason: "robots-disallowed" }));
  });

  it("does not render or price Tavily challenge content", async () => {
    const render = vi.fn(async (url: string) => ({ markdown: MENU, links: [], finalUrl: url }));
    const deps = fakeDeps({
      "https://thefeathers.co.uk/": HOME,
      "https://thefeathers.co.uk/drinks": `Just a moment... cf-browser-verification challenge-platform\n${MENU}`,
    }, { render });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(render).not.toHaveBeenCalledWith("https://thefeathers.co.uk/drinks");
    expect(outcome.rows).toEqual([]);
    expect(outcome.refusals).toContainEqual(expect.objectContaining({ reason: "blocked-by-challenge" }));
  });

  it.each([
    { ok: false, status: 403, body: "", finalUrl: SITE },
    { ok: false, status: 0, body: "", finalUrl: SITE, reason: "robots-disallowed" },
    { ok: true, status: 200, body: "Just a moment... cf-browser-verification challenge-platform", finalUrl: SITE },
  ])("preserves a direct acquisition refusal", async (page) => {
    const render = vi.fn(async (url: string) => ({ markdown: MENU, links: [], finalUrl: url }));
    const deps = fakeDeps({ [SITE]: MENU }, { siteLinks: async () => siteLinksFromPage(page), render });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.rows).toEqual([]);
    expect(outcome.refusals).toHaveLength(1);
    expect(deps.extract).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});

describe("bounded menu journeys", () => {
  it.each(["html", "markdown", "browserbase"])("follows a menu landing page through %s to its PDF", async (via) => {
    const menuUrl = "https://thefeathers.co.uk/menus";
    const pdfUrl = "https://thefeathers.co.uk/files/drinks.pdf";
    const readPdf = vi.fn(async (url: string) => ({ text: MENU, finalUrl: url }));
    const deps = fakeDeps({
      "https://thefeathers.co.uk/": "[Menus](/menus)",
      [menuUrl]: via === "markdown" ? "[Drinks PDF](/files/drinks.pdf)" : "Loading menus...",
    }, {
      readPdf,
      siteLinks: async (url: string) => siteLinksFromPage({
        ok: true, body: via === "html" && url === menuUrl ? '<a href="/files/drinks.pdf">Drinks</a>' : "", finalUrl: url,
      }),
      render: via === "browserbase" ? async (url: string) => ({ markdown: "Our menus", links: [pdfUrl], finalUrl: url }) : null,
    });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.outcome).toBe("priced");
    expect(outcome.rows.every((row) => row.url === pdfUrl)).toBe(true);
    expect(readPdf).toHaveBeenCalledWith(pdfUrl);
    expect(deps.robots).toHaveBeenCalledWith(pdfUrl);
  });

  it("extracts a newly rendered link before considering it for rendering", async () => {
    const render = vi.fn(async (url: string) => ({ markdown: "Our drinks", links: ["https://thefeathers.co.uk/drinks"], finalUrl: url }));
    const deps = fakeDeps({ "https://thefeathers.co.uk/": "Welcome" }, { render });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(render.mock.calls.map(([url]) => url)).toEqual([PUB.website]);
    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).toContain("https://thefeathers.co.uk/drinks");
    expect(outcome.rows).toEqual([]);
  });

  it("keeps the menu-page cap across linked menus", async () => {
    const deps = fakeDeps({
      "https://thefeathers.co.uk/": "[Menus](/menus)",
      "https://thefeathers.co.uk/menus": "[Drinks](/drinks) [Wine](/wine-list) [More](/cocktails)",
      "https://thefeathers.co.uk/drinks": MENU,
      "https://thefeathers.co.uk/wine-list": MENU,
      "https://thefeathers.co.uk/cocktails": MENU,
    });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.outcome).toBe("priced");
    expect(outcome.pages.filter((page) => page.kind === "menu")).toHaveLength(3);
    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).not.toContain("https://thefeathers.co.uk/cocktails");
  });

  it("renders a drinks page whose only static price is room hire", async () => {
    const render = vi.fn(async (url: string) => ({ markdown: MENU, links: [], finalUrl: url }));
    const deps = fakeDeps({
      "https://thefeathers.co.uk/": HOME,
      "https://thefeathers.co.uk/drinks": "Room hire £50. Loading drinks...",
    }, { render });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.outcome).toBe("priced");
    expect(outcome.rows.every((row) => row.renderer === "browserbase")).toBe(true);
  });

  it("resolves HTML menu and contact links from the final page path", async () => {
    const siteUrl = "https://thefeathers.co.uk/pub/";
    const deps = fakeDeps({
      [SITE]: "Welcome",
      [`${siteUrl}drinks`]: MENU,
      [`${siteUrl}contact`]: "SE1 9AA",
    }, {
      search: async () => ({ results: [{ url: SITE, title: "", content: "" }], credits: 1 }),
      siteLinks: async (url: string) => siteLinksFromPage({
        ok: true,
        body: url === SITE ? '<a href="drinks">Drinks</a><a href="contact">Contact</a><a href="https://other.co.uk/menu">Menu</a>' : "",
        finalUrl: url === SITE ? siteUrl : url,
      }),
    });
    const outcome = await first([target({ ...PUB, website: null })], deps, createCreditBudget(10));
    expect(outcome.outcome).toBe("priced");
    expect(outcome.addressBound).toBe(true);
    expect(outcome.rows.every((row) => row.url === `${siteUrl}drinks`)).toBe(true);
    expect(outcome.pages).toContainEqual(expect.objectContaining({ url: `${siteUrl}contact`, error: null }));
  });
});

describe("capacity, ownership and attribution", () => {
  it.each([
    { credits: 1, priced: 5 },
    { credits: 0.3, priced: 1 },
    { credits: 0, priced: 0 },
  ])("reads $priced of twenty stated sites with $credits credits", async ({ credits, priced }) => {
    const sites = Array.from({ length: 20 }, (_, index) => `https://feathers${index}.co.uk/`);
    const targets = sites.map((website, index) => target({
      ...PUB, osmId: `node/${index + 1}`, website,
    }));
    const pages = Object.fromEntries(sites.map((site) => [site, MENU]));
    const budget = createCreditBudget(credits);
    const outcomes = await harvestPubBatch(targets, fakeDeps(pages), budget);

    expect(outcomes).toHaveLength(20);
    expect(outcomes.slice(0, priced).every((outcome) => outcome.outcome === "priced" && outcome.rows.length === 5)).toBe(true);
    expect(outcomes.slice(priced).every((outcome) => outcome.outcome === "budget-spent" && outcome.pagesRead === 0)).toBe(true);
    expect(budget.spent).toBeCloseTo(priced * 0.2);

    const remaining = targets.filter((_, index) => outcomes[index]?.outcome === "budget-spent");
    const resumed = await harvestPubBatch(remaining, fakeDeps(pages), createCreditBudget(1));
    expect(resumed.filter((outcome) => outcome.outcome === "priced")).toHaveLength(5);
  });

  it("keeps affordable menu prices while marking the remaining menu for a retry", async () => {
    const deps = fakeDeps({
      [SITE]: "[Beer](/drinks/beer) [Wine](/drinks/wine) [Soft drinks](/drinks/soft)",
      "https://thefeathers.co.uk/drinks/beer": MENU,
      "https://thefeathers.co.uk/drinks/wine": MENU,
      "https://thefeathers.co.uk/drinks/soft": MENU,
    });
    const budget = createCreditBudget(0.6);
    const outcome = await first([target()], deps, budget);

    expect(outcome.outcome).toBe("budget-spent");
    expect(outcome.rows).toHaveLength(5);
    expect(outcome.pagesRead).toBe(3);
    expect(outcome.pages).toContainEqual(expect.objectContaining({
      url: "https://thefeathers.co.uk/drinks/soft", error: "budget-spent", via: null,
    }));
    expect(budget.spent).toBeCloseTo(0.6);
  });

  it("reserves menu reads before spending a credit on site search", async () => {
    const siteSearch = vi.fn(async () => ({
      results: [{ url: "https://thefeathers.co.uk/drinks", title: "", content: "" }], credits: 1,
    }));
    const deps = fakeDeps({ [SITE]: "Welcome" }, {
      siteSearch,
    });
    const budget = createCreditBudget(1.2);
    const outcome = await first([target()], deps, budget);
    expect(outcome.outcome).toBe("budget-spent");
    expect(siteSearch).not.toHaveBeenCalled();
    expect(budget.spent).toBeCloseTo(0.2);
  });

  it("reads the menu found by a site search when its read capacity is available", async () => {
    const siteSearch = vi.fn(async () => ({
      results: [{ url: "https://thefeathers.co.uk/drinks", title: "", content: "" }], credits: 1,
    }));
    const deps = fakeDeps({ [SITE]: "Welcome", "https://thefeathers.co.uk/drinks": MENU }, { siteSearch });
    const budget = createCreditBudget(1.8);
    const outcome = await first([target()], deps, budget);
    expect(outcome.outcome).toBe("priced");
    expect(outcome.rows).toHaveLength(5);
    expect(budget.spent).toBeCloseTo(1.4);
  });

  it("preserves exhaustion when a site search cannot start", async () => {
    const siteSearch = vi.fn();
    const deps = fakeDeps({ [SITE]: "Welcome" }, { siteSearch });
    const outcome = await first([target()], deps, createCreditBudget(0.2));
    expect(outcome.outcome).toBe("budget-spent");
    expect(siteSearch).not.toHaveBeenCalled();
  });

  it("preserves render exhaustion alongside partial prices", async () => {
    const deps = fakeDeps({
      [SITE]: "[Drinks](/drinks) [Wine](/wine-list)",
      "https://thefeathers.co.uk/drinks": MENU,
      "https://thefeathers.co.uk/wine-list": "Loading wine...",
    }, {
      render: async (url: string) => ({ markdown: MENU, links: [], finalUrl: url }),
      renderBudget: { take: () => false },
    });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.outcome).toBe("budget-spent");
    expect(outcome.rows.length).toBeGreaterThan(0);
  });

  it("does not let an unbound namesake reserve the correct pub's host in the same batch", async () => {
    const claims = new Map<string, string>();
    const wrong = { ...PUB, website: null, osmId: "node/2", postcode: "LS1 1AA", address: "1, Other Road, LS1 1AA" };
    const right = { ...PUB, website: null };
    const deps = fakeDeps({
      "https://thefeathers.co.uk/": `${HOME}\nSE1 9AA`,
      "https://thefeathers.co.uk/drinks": MENU,
    }, {
      search: async () => ({ results: [{ url: PUB.website, title: "", content: "" }], credits: 1 }),
      claimedBy: (host: string) => claims.get(host) ?? null,
      claim: (host: string, osmId: string) => { claims.set(host, osmId); },
    });
    const outcomes = await harvestPubBatch([target(wrong), target(right)], deps, createCreditBudget(10));
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["site-unbound", "priced"]);
    expect(claims.get("thefeathers.co.uk")).toBe(PUB.osmId);
    expect(outcomes.map((outcome) => outcome.addressBound)).toEqual([false, true]);
  });

  it("keeps this pub's prices when an unowned estate page has cheaper copies", async () => {
    const own = "https://thefeathers.co.uk/pubs/the-feathers/drinks";
    const other = "https://thefeathers.co.uk/drinks";
    const deps = fakeDeps({
      [SITE]: `[Our drinks](${own}) [Estate drinks](${other})`,
      [own]: MENU,
      [other]: MENU.replace("£6.20", "£5.20").replace("£6.40", "£5.40").replace("£7.50", "£5.50").replace("£3.20", "£2.20").replace("£2.90", "£1.90"),
    });
    const outcome = await first([target(PUB, { pubsOnHost: 4 })], deps, createCreditBudget(10));
    expect(outcome.outcome).toBe("priced");
    expect(outcome.rows.every((row) => row.url === own)).toBe(true);
    expect(outcome.rows.map((row) => row.priceGbp).sort((a, b) => a - b)).toEqual([2.90, 3.20, 6.20, 6.40, 7.50]);
  });
});

describe("detected PDF transport and resumable discovery", () => {
  it.each(["seed", "html"])("reads a discovered %s menu when its homepage fails", async (via) => {
    const menuUrl = "https://thefeathers.co.uk/drinks";
    const pub = { ...PUB, website: null };
    const deps = fakeDeps({ [menuUrl]: `${MENU}\nSE1 9AA` }, {
      search: async () => ({ results: [{ url: via === "seed" ? menuUrl : SITE, title: "", content: "" }], credits: 1 }),
      siteLinks: async (url: string) => ({ menu: via === "html" && url === SITE ? [menuUrl] : [], contact: [] }),
    });
    const outcome = await first([target(pub)], deps, createCreditBudget(10));

    expect(outcome.outcome).toBe("priced");
    expect(outcome.addressBound).toBe(true);
    expect(outcome.rows).toHaveLength(5);
    expect(outcome.rows.every((row) => row.url === menuUrl)).toBe(true);
    expect(outcome.pages).toContainEqual(expect.objectContaining({ url: SITE, error: "tavily: not found" }));
  });

  it("requires the address on a discovered menu when its homepage fails", async () => {
    const menuUrl = "https://thefeathers.co.uk/drinks";
    const deps = fakeDeps({ [menuUrl]: MENU }, {
      search: async () => ({ results: [{ url: menuUrl, title: "", content: "" }], credits: 1 }),
    });
    const outcome = await first([target({ ...PUB, website: null })], deps, createCreditBudget(10));

    expect(outcome.outcome).toBe("site-unbound");
    expect(outcome.addressBound).toBe(false);
    expect(outcome.pagesRead).toBe(1);
    expect(outcome.rows).toEqual([]);
  });

  it.each(["start", "menu"])("reads an extensionless %s PDF through its text layer", async (kind) => {
    const download = "https://thefeathers.co.uk/drinks/download";
    const pdfUrl = kind === "start" ? SITE : download;
    const readPdf = vi.fn(async (url: string) => ({ text: MENU, finalUrl: url }));
    const deps = fakeDeps({ [SITE]: `[Drinks](${download})`, [download]: "Flattened columns" }, {
      readPdf,
      siteLinks: async (url: string) => siteLinksFromPage({
        ok: true, body: "", finalUrl: url, pdf: url === pdfUrl,
      }),
    });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.outcome).toBe("priced");
    expect(outcome.rows.every((row) => row.renderer === "pdf-text" && row.url === pdfUrl)).toBe(true);
    expect(outcome.rows.map((row) => row.priceGbp).sort((a, b) => a - b)).toEqual([2.90, 3.20, 6.20, 6.40, 7.50]);
    expect(readPdf).toHaveBeenCalledWith(pdfUrl);
    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).not.toContain(pdfUrl);
  });

  it("never falls back to flattened extraction when a detected PDF has no text", async () => {
    const deps = fakeDeps({ [SITE]: MENU }, {
      siteLinks: async (url: string) => siteLinksFromPage({ ok: true, pdf: true, body: "", finalUrl: url }),
      readPdf: async () => ({ error: "pdf has no text layer" }),
    });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.rows).toEqual([]);
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it("leaves extraction capacity when many pubs need paid discovery", async () => {
    const pubs = Array.from({ length: 20 }, (_, index) => ({
      ...PUB, website: null, osmId: `node/${index + 1}`, name: `The Feathers ${index}`,
    }));
    const pages = Object.fromEntries(pubs.flatMap((pub, index) => [
      [`https://feathers${index}.co.uk/`, `${HOME}\n${pub.postcode}`],
      [`https://feathers${index}.co.uk/drinks`, MENU],
    ]));
    const search = vi.fn(async (query: string) => {
      const index = pubs.findIndex((pub) => query.includes(`"${pub.name}"`));
      return { results: [{ url: `https://feathers${index}.co.uk/`, title: "", content: "" }], credits: 1 };
    });
    const budget = createCreditBudget(20);
    const outcomes = await harvestPubBatch(pubs.map((pub) => target(pub)), fakeDeps(pages, { search }), budget);
    expect(search).toHaveBeenCalledTimes(10);
    expect(outcomes.filter((outcome) => outcome.outcome === "priced")).toHaveLength(10);
    expect(outcomes.filter((outcome) => outcome.outcome === "budget-spent")).toHaveLength(10);
    expect(budget.spent).toBeLessThanOrEqual(20);
  });

  it("keeps pending menu reads available when another pub needs site search", async () => {
    const secondSite = "https://feathers-se1.co.uk/";
    const siteSearch = vi.fn(async () => ({ results: [], credits: 1 }));
    const deps = fakeDeps({
      [SITE]: "Welcome",
      [secondSite]: HOME,
      [`${secondSite}drinks`]: MENU,
    }, { siteSearch });
    const outcomes = await harvestPubBatch([
      target(), target({ ...PUB, osmId: "node/2", website: secondSite }),
    ], deps, createCreditBudget(1.6));
    expect(siteSearch).not.toHaveBeenCalled();
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["budget-spent", "priced"]);
  });

  it("retains a discovery for a budget retry and still requires address binding", async () => {
    const pub = { ...PUB, website: null };
    const deps = fakeDeps({
      [SITE]: `${HOME}\nSE1 9AA`,
      "https://thefeathers.co.uk/drinks": "Loading drinks...",
    }, {
      search: async () => ({ results: [{ url: SITE, title: "", content: "" }], credits: 1 }),
      render: async (url: string) => ({ markdown: MENU, links: [], finalUrl: url }),
      renderBudget: { take: () => false },
    });
    const saved = await first([target(pub)], deps, createCreditBudget(2));
    expect(saved.outcome).toBe("budget-spent");
    expect(saved.siteUrl).toBe(SITE);
    expect(saved.discovered).toBe(true);
    const resumed = target(pub, { siteUrl: saved.siteUrl, discovered: saved.discovered });
    const search = vi.fn();
    const good = await first([resumed], fakeDeps({
      [SITE]: `${HOME}\nSE1 9AA`, "https://thefeathers.co.uk/drinks": MENU,
    }, { search }), createCreditBudget(1));
    expect(good.outcome).toBe("priced");
    expect(good.addressBound).toBe(true);
    const namesake = await first([resumed], fakeDeps({
      [SITE]: `${HOME}\nLS1 1AA`, "https://thefeathers.co.uk/drinks": MENU,
    }, { search }), createCreditBudget(1));
    expect(namesake.outcome).toBe("site-unbound");
    expect(namesake.rows).toEqual([]);
    const missingAddress = await first([target({ ...pub, postcode: null, address: null }, {
      siteUrl: saved.siteUrl, discovered: saved.discovered,
    })], fakeDeps({}, { search }), createCreditBudget(1));
    expect(missingAddress.outcome).toBe("no-address-to-bind");
    expect(search).not.toHaveBeenCalled();
  });
});
