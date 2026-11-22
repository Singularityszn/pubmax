import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { defined } from "@/__tests__/helpers/defined";
import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";
import {
  createCreditBudget,
  discoveredSiteFor,
  harvestPubBatch,
  permittedTavilySite,
  siteLinksFromPage,
  tavilyOutcomeNeedsRetry,
  type CreditBudget,
  type SnapshotPub,
  type TavilyLaneDeps,
  type TavilyLaneTarget,
} from "../scripts/harvest/uk-prices/tavilyLane.mjs";
import { persistTavilyRows } from "../scripts/harvest/uk-prices/tavily.mjs";
import { fetchTinyfishPage } from "../scripts/lib/localRefreshProviders.mjs";
import { permittedPubSite } from "../scripts/harvest/uk-prices/pubSites.mjs";

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

const UNPRICED_MENU = [
  "# Our drinks list",
  "Our bar serves a changing selection of draught beers, bottled beers, wines, spirits and soft drinks.",
  "Ask the bar team about the current selection and the price of each serving before you order.",
  "Draught beers include Guinness, Camden Hells, Peroni and locally brewed pale ales.",
  "Our wine selection includes Merlot, Pinot Grigio, Sauvignon Blanc and sparkling wines by the bottle.",
  "Alcohol-free choices include lemonade, cola, ginger beer, tonic water, fruit juices and sparkling water.",
].join("\n");

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
    expect(outcome.rows.map((row) => row.drinkLabel)).toContain("Guinness, pint");
    expect(budget.spent).toBeCloseTo(0.4);
  });

  it("keeps a stated drinks-page website for the next run when Tavily cannot read it", async () => {
    const drinksSite = "https://risingsun.co.uk/drinks/";
    const pub = { ...PUB, website: drinksSite };
    const failed = await first([target(pub)], fakeDeps({}), createCreditBudget(10));
    expect(failed.outcome).toBe("partial");
    expect(failed.pendingUrls).toEqual([drinksSite]);

    const retried = await first([target(pub, JSON.parse(JSON.stringify(failed)))], fakeDeps({ [drinksSite]: MENU }), createCreditBudget(10));
    expect(retried.outcome).toBe("priced");
    expect(retried.pendingUrls).toEqual([]);
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

describe("spending the per-pub page cap", () => {
  it("reads markdown drinks links before food links already queued from HTML", async () => {
    const food = ["sunday-menu", "dessert-menu", "food-menu"].map((name) => new URL(`/menus/${name}`, SITE).href);
    const drinks = new URL("/menus/drinks", SITE).href;
    const deps = fakeDeps({ [SITE]: `[Drinks](${drinks})`, [drinks]: MENU }, {
      siteLinks: async (url: string) => siteLinksFromPage({
        ok: true, finalUrl: url,
        body: url === SITE ? food.map((href) => `<a href="${href}">Menu</a>`).join("") : "",
      }),
    });
    const outcome = await first([target()], deps, createCreditBudget(10));

    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).toEqual([SITE, drinks, ...food.slice(0, 2)]);
    expect(outcome.rows).toHaveLength(5);
    expect(outcome.pendingUrls).toContain(food[2]);
  });

  it.each(["discovery", "site-search", "restored"])("prioritises drinks in %s seeds", async (via) => {
    const food = ["sunday-menu", "dessert-menu", "food-menu"].map((name) => new URL(`/menus/${name}`, SITE).href);
    const drinks = new URL("/menus/drinks", SITE).href;
    const urls = [...food, drinks];
    const pub = { ...PUB, website: via === "discovery" ? null : SITE };
    const answer = async () => ({ results: urls.map((url) => ({ url, title: "", content: "" })), credits: 1 });
    const deps = fakeDeps({ [SITE]: "Welcome", [drinks]: `${MENU}\nSE1 9AA` }, { search: answer, siteSearch: answer });
    const outcome = await first([target(pub, via === "restored" ? { seedUrls: urls } : {})], deps, createCreditBudget(10));

    const menuReads = deps.extract.mock.calls.flatMap(([read]) => read).filter((url) => url !== SITE);
    expect(menuReads).toEqual([drinks, ...food.slice(0, 2)]);
    expect(outcome.rows).toHaveLength(5);
    expect(outcome.pendingUrls).toContain(food[2]);
  });

  it("reads drinks pages before food menus, and one page once whatever its dialog parameter", async () => {
    const pages = {
      [SITE]: "[Sunday](/menus/sunday-menu) [Booking](/menus?modal=booking) [Menus](/menus) [Kids](/menus/kids-menu) [Cocktails](/menus/cocktails) [Wine](/menus/wine-list)",
      "https://thefeathers.co.uk/menus": MENU,
      "https://thefeathers.co.uk/menus/cocktails": MENU,
      "https://thefeathers.co.uk/menus/wine-list": MENU,
    };
    const deps = fakeDeps(pages);
    const outcome = await first([target()], deps, createCreditBudget(10));
    const read = deps.extract.mock.calls.flatMap(([urls]) => urls);

    expect(read).toEqual(expect.arrayContaining([
      "https://thefeathers.co.uk/menus/cocktails",
      "https://thefeathers.co.uk/menus/wine-list",
      "https://thefeathers.co.uk/menus",
    ]));
    expect(read).not.toContain("https://thefeathers.co.uk/menus?modal=booking");
    expect(read).not.toContain("https://thefeathers.co.uk/menus/sunday-menu");
    expect(outcome.pendingUrls).toEqual(["https://thefeathers.co.uk/menus/sunday-menu"]);
  });

  it.each(["discovery", "site-search", "restored", "html", "markdown", "rendered"])("prioritises content query drinks menus from %s", async (via) => {
    const food = ["food", "sunday", "dessert"].map((section) => new URL(`/menus?section=${section}`, SITE).href);
    const wine = new URL("/menus?section=%77%69%6e%65", SITE).href;
    const urls = [...food, wine];
    const pub = { ...PUB, website: via === "discovery" ? null : SITE };
    const answer = async () => ({ results: urls.map((url) => ({ url, title: "", content: "" })), credits: 1 });
    const links = urls.map((url) => `[Menu](${url})`).join(" ");
    const deps = fakeDeps({
      [SITE]: via === "markdown" ? links : "Welcome",
      [wine]: `${MENU}\nSE1 9AA`,
      ...Object.fromEntries(food.map((url) => [url, "Food menu"])),
    }, {
      search: answer,
      siteSearch: via === "site-search" ? answer : undefined,
      siteLinks: async (url: string) => ({ menu: via === "html" && url === SITE ? urls : [], contact: [] }),
      render: async (url: string) => ({
        markdown: UNPRICED_MENU, links: via === "rendered" && url === SITE ? urls : [], finalUrl: url,
      }),
    });
    const outcome = await first([target(pub, via === "restored" ? { seedUrls: urls } : {})], deps, createCreditBudget(10));

    const menuReads = deps.extract.mock.calls.flatMap(([read]) => read).filter((url) => url !== SITE);
    expect(menuReads).toEqual([wine, ...food.slice(0, 2)]);
    expect(outcome.rows).toHaveLength(5);
    expect(outcome.pendingUrls).toContain(food[2]);
  });
});

describe("menu URL identity across discovery and saved progress", () => {
  const menu = new URL("/menus", SITE).href;
  const decorated = `${menu}?modal=booking&scroll-to=bar&scrollto=bar&utm_source=contact&utm_campaign_id=1&fbclid=1&gclid=1&ref=home`;
  const wine = `${menu}?section=wine`;

  it.each(["discovery", "site-search", "restored"])("reads each %s page once and retains content parameters", async (via) => {
    const urls = [decorated, menu, wine];
    const pub = { ...PUB, website: via === "discovery" ? null : SITE };
    const answer = async () => ({ results: urls.map((url) => ({ url, title: "", content: "" })), credits: 1 });
    const deps = fakeDeps({ [SITE]: "Welcome", [menu]: `${MENU}\nSE1 9AA`, [wine]: MENU }, {
      search: answer, siteSearch: answer,
    });
    const outcome = await first([target(pub, via === "restored" ? { seedUrls: urls, pendingUrls: urls } : {})], deps, createCreditBudget(10));

    expect(deps.extract.mock.calls.flatMap(([read]) => read).filter((url) => url !== SITE)).toEqual(via === "restored" ? [menu, wine] : [wine, menu]);
    expect(outcome.seedUrls).toEqual([menu, wine]);
    expect(outcome.completedUrls).toEqual([menu, wine]);
    expect(outcome.pendingUrls).toEqual([]);
    expect(outcome.rows).toHaveLength(5);
  });

  it.each([menu, decorated])("does not reread a completed page saved as %s", async (completed) => {
    const deps = fakeDeps({ [wine]: MENU });
    const outcome = await first([target(PUB, {
      completedUrls: [completed], seedUrls: [decorated, menu], pendingUrls: [wine],
    })], deps, createCreditBudget(10));

    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).toEqual([wine]);
    expect(outcome.completedUrls).toEqual([menu, wine]);
    expect(outcome.pendingUrls).toEqual([]);
  });

  it("matches saved start and binding pages without dialog parameters", async () => {
    const deps = fakeDeps({ [SITE]: `${MENU}\nSE1 9AA` });
    const outcome = await first([target(PUB, {
      siteUrl: `${SITE}?utm_source=mail`, discovered: true, bindingUrl: `${SITE}?modal=booking`,
      pendingUrls: [SITE],
    })], deps, createCreditBudget(10));

    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).toEqual([SITE]);
    expect(outcome.pages).toEqual([expect.objectContaining({ url: SITE, kind: "start" })]);
    expect(outcome.bindingUrl).toBe(SITE);
    expect(outcome.addressBound).toBe(true);
    expect(outcome.pendingUrls).toEqual([]);
  });
});

describe("rendering through TinyFish", () => {
  it("keeps menu acquisition pending when TinyFish supplies no resolved landing", async () => {
    const menu = new URL("/drinks", SITE).href;
    const outcome = await first([target()], fakeDeps({ [SITE]: HOME, [menu]: "Loading menu..." }, {
      render: (url: string) => fetchTinyfishPage({
        url,
        environment: { TINYFISH_API_KEY: "key" },
        fetchImpl: async () => Response.json({ results: [{ url, final_url: null, text: MENU }], errors: [] }),
      }),
    }), createCreditBudget(10));

    expect(outcome.outcome).toBe("partial");
    expect(outcome.pendingUrls).toEqual([menu]);
    expect(outcome.completedUrls).not.toContain(menu);
    expect(outcome.rows).toEqual([]);
  });

  it.each(["blocked-by-challenge", "refused-by-site"])("retains a renderer refusal across a partial continuation: %s", async (reason) => {
    const wine = new URL("/wine-list", SITE).href;
    const cocktails = new URL("/cocktails", SITE).href;
    const render = vi.fn(async (url: string) => {
      if (url === wine) throw Object.assign(new Error("site refused"), { refusal: reason });
      return { markdown: "Loading menu...", links: [], finalUrl: url };
    });
    const deps = fakeDeps({ [SITE]: "Welcome", [wine]: "Loading wine...", [cocktails]: "Loading cocktails..." }, {
      siteSearch: async () => ({ results: [wine, cocktails].map((url) => ({ url, title: "", content: "" })), credits: 1 }),
      render,
    });
    const partial = await first([target()], deps, createCreditBudget(10));
    expect(partial.outcome).toBe("partial");
    expect(partial.seedUrls).toEqual([wine, cocktails]);
    expect(partial.pendingUrls).toEqual([cocktails]);

    const retry = fakeDeps({ [cocktails]: MENU }, { render });
    render.mockClear();
    const complete = await first([target(PUB, JSON.parse(JSON.stringify(partial)))], retry, createCreditBudget(10));
    expect(retry.extract.mock.calls.flatMap(([urls]) => urls)).toEqual([cocktails]);
    expect(render).not.toHaveBeenCalled();
    expect(complete.refusals).toContainEqual({ url: wine, reason });
    expect(complete.outcome).toBe("priced");
    expect(complete.rows).toHaveLength(5);
  });

  it.each(["pending", "seed", "html", "markdown", "rendered", "site-search", "discovery", "start", "binding"])(
    "does not read a saved refusal admitted through %s", async (via) => {
      const refused = via === "start" || via === "binding" ? SITE : new URL("/wine-list", SITE).href;
      const decorated = `${refused}?modal=booking`;
      const refusals = [{ url: decorated, reason: "blocked-by-challenge" }];
      const pub = { ...PUB, website: via === "discovery" || via === "binding" ? null : SITE };
      const answer = async () => ({ results: [{ url: refused, title: "", content: "" }], credits: 1 });
      const deps = fakeDeps({ [SITE]: via === "markdown" ? `[Wine](${refused})` : "Welcome", [refused]: MENU }, {
        search: answer,
        siteSearch: via === "site-search" ? answer : undefined,
        siteLinks: async () => ({ menu: via === "html" ? [refused] : [], contact: [] }),
        render: async (url: string) => ({ markdown: UNPRICED_MENU, links: via === "rendered" ? [refused] : [], finalUrl: url }),
      });
      const outcome = await first([target(pub, {
        refusals,
        pendingUrls: via === "pending" ? [refused] : [],
        seedUrls: via === "seed" ? [refused] : [],
        ...(via === "binding" ? { siteUrl: SITE, discovered: true, bindingUrl: refused } : {}),
      })], deps, createCreditBudget(10));

      expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).not.toContain(refused);
      expect(outcome.pendingUrls).not.toContain(refused);
      expect(outcome.refusals).toContainEqual(refusals[0]);
      expect(outcome.rows).toEqual([]);
    },
  );

  it("labels rows by the renderer that read them", async () => {
    const render = vi.fn(async (url: string) => ({ markdown: MENU, links: [], finalUrl: url, via: "tinyfish" as const }));
    const deps = fakeDeps({ [SITE]: HOME, "https://thefeathers.co.uk/drinks": "Loading menu..." }, { render });
    const outcome = await first([target()], deps, createCreditBudget(10));

    expect(outcome.outcome).toBe("priced");
    expect(outcome.rows.every((row) => row.renderer === "tinyfish")).toBe(true);
  });

  it("records a site's refusal to the renderer as final, not as work to retry", async () => {
    const render = vi.fn(async () => {
      throw Object.assign(new Error("tinyfish could not fetch: bot_blocked"), { refusal: "blocked-by-challenge" });
    });
    const deps = fakeDeps({ [SITE]: HOME, "https://thefeathers.co.uk/drinks": "Loading menu..." }, { render });
    const outcome = await first([target()], deps, createCreditBudget(10));

    expect(outcome.refusals).toContainEqual(expect.objectContaining({ reason: "blocked-by-challenge" }));
    expect(outcome.pendingUrls).not.toContain("https://thefeathers.co.uk/drinks");
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

  it.each([
    ["The Cider Box", "theciderbox.com"],
    ["Shepherd and Dog", "shepherdanddogessex.com"],
    ["The Sly Old Fox", "theslyoldfox.com"],
    ["Windsor Complex", "windsorcomplex.com"],
  ])("reads %s from a stated or discovered site", async (name, host) => {
    const site = `https://${host}/`;
    expect(permittedPubSite(site)?.host).toBe(host);
    for (const website of [site, null]) {
      const pub = { ...PUB, name, website };
      const deps = fakeDeps({ [site]: `${MENU}\nSE1 9AA` }, {
        search: async () => ({ results: [{ url: site, title: name, content: "" }], credits: 1 }),
      });
      const outcome = await first([target(pub)], deps, createCreditBudget(10));
      expect(outcome.outcome).toBe("priced");
      expect(outcome.rows).toHaveLength(5);
      expect(outcome.rows.every((row) => row.url === site)).toBe(true);
      expect(deps.robots).toHaveBeenCalledWith(site);
    }
  });

  it.each([
    "x.com", "pub.x.com", "twitter.com", "pub.twitter.com",
    "facebook.com", "instagram.com", "tripadvisor.co.uk", "yelp.com",
    "google.co.uk", "linktr.ee", "pub.wixsite.com", "whatpub.com",
  ])("refuses the third-party domain %s", (host) => {
    const site = `https://${host}/drinks`;
    expect(permittedPubSite(site)).toBeNull();
    expect(permittedTavilySite(site)).toBe(false);
  });

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

  it("requires address binding for a compound name without distinctive words", async () => {
    const site = "https://slyoldfox.co.uk/";
    const pub = { ...unlisted, name: "The Sly Old Fox" };
    const search = async () => ({ results: [{ url: site, title: pub.name, content: "SE1 9AA" }], credits: 1 });
    const unbound = await first([target(pub)], fakeDeps({ [site]: `${MENU}\nLS1 1AA` }, { search }), createCreditBudget(10));
    expect(unbound.outcome).toBe("site-unbound");
    expect(unbound.rows).toEqual([]);

    const bound = await first([target(pub)], fakeDeps({ [site]: `${MENU}\nSE1 9AA` }, { search }), createCreditBudget(10));
    expect(bound.outcome).toBe("priced");
    expect(bound.addressBound).toBe(true);
    expect(bound.rows).toHaveLength(5);
    expect(discoveredSiteFor(pub, [{ url: "https://fox.co.uk/", title: pub.name, content: "SE1 9AA" }]))
      .toMatchObject({ refusal: "no-site-found" });
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
  it.each(["unconfigured", "exhausted", "failed"])("retains static prices and retries when rendering is %s", async (mode) => {
    const wineUrl = "https://thefeathers.co.uk/wine-list";
    const beerUrl = "https://thefeathers.co.uk/drinks";
    const pages = {
      [SITE]: "[Beer](/drinks) [Wine](/wine-list)",
      [beerUrl]: MENU.replace("## Wine\n- House Merlot 175ml £7.50", "- Peroni, pint £6.50"),
      [wineUrl]: "Loading wine...",
    };
    const deps = fakeDeps(pages, {
      render: mode === "unconfigured" ? null : async () => { throw new Error("renderer unavailable"); },
      renderBudget: { take: () => mode !== "exhausted" },
    });
    const partial = await first([target()], deps, createCreditBudget(10));
    expect(partial.outcome).toBe("partial");
    expect(partial.rows).toHaveLength(5);
    expect(partial.rows).toContainEqual(expect.objectContaining({ category: "beer", priceGbp: 6.40, url: beerUrl }));
    expect(partial.rows.some((row) => row.category === "wine")).toBe(false);
    expect(partial.pages).toHaveLength(3);
    expect(tavilyOutcomeNeedsRetry(partial.outcome)).toBe(true);

    const complete = await first([target()], fakeDeps(pages, {
      render: async (url: string) => ({ markdown: MENU, links: [], finalUrl: url }),
    }), createCreditBudget(10));
    expect(complete.outcome).toBe("priced");
    expect(complete.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "beer", priceGbp: 6.40, url: beerUrl }),
      expect.objectContaining({ category: "wine", priceGbp: 7.50, url: wineUrl, renderer: "browserbase" }),
    ]));
    expect(complete.rows).toHaveLength(6);
    expect(tavilyOutcomeNeedsRetry(complete.outcome)).toBe(false);
  });

  it.each(["Loading...", `${"Welcome to our pub. ".repeat(30)} Content is loading...`, "Loading drinks...", "The Feathers Drinks"])(
    "keeps an unfinished rendered menu pending: %s", async (markdown) => {
      const menuUrl = new URL("/drinks", SITE).href;
      const pages = { [SITE]: HOME, [menuUrl]: "Loading menu..." };
      const partial = await first([target()], fakeDeps(pages, {
        render: async (url: string) => ({ markdown, links: [], finalUrl: url }),
      }), createCreditBudget(10));
      expect(partial.outcome).toBe("partial");
      expect(partial.pendingUrls).toEqual([menuUrl]);
      expect(partial.completedUrls).not.toContain(menuUrl);
      const complete = await first([target(PUB, partial)], fakeDeps(pages, {
        render: async (url: string) => ({ markdown: MENU, links: [], finalUrl: url }),
      }), createCreditBudget(10));
      expect(complete.outcome).toBe("priced");
      expect(complete.rows).toHaveLength(5);
      expect(complete.pendingUrls).toEqual([]);
    },
  );

  it.each(["start", "seed"])("keeps an empty rendered %s pending", async (kind) => {
    const url = kind === "start" ? SITE : new URL("/drinks", SITE).href;
    const outcome = await first([target(PUB, kind === "seed" ? { seedUrls: [url] } : {})], fakeDeps({
      [SITE]: "Welcome", [url]: "The Feathers Drinks",
    }, {
      render: async (finalUrl: string) => ({ markdown: "The Feathers Drinks", links: [], finalUrl }),
    }), createCreditBudget(10));
    expect(outcome.outcome).toBe("partial");
    expect(outcome.pendingUrls).toContain(url);
    expect(outcome.completedUrls).not.toContain(url);
  });

  it("uses a one-page allowance for the pending menu instead of repeating the homepage", async () => {
    const menuUrl = new URL("/drinks", SITE).href;
    const deps = fakeDeps({ [SITE]: HOME, [menuUrl]: MENU });
    const partial = await first([target()], deps, createCreditBudget(0.2));
    expect(partial.pendingUrls).toEqual([menuUrl]);
    const complete = await first([target(PUB, partial)], deps, createCreditBudget(0.2));
    expect(complete.outcome).toBe("priced");
    expect(complete.rows).toHaveLength(5);
    expect(complete.pendingUrls).toEqual([]);
  });

  it("uses retained address binding while reading only the pending seed", async () => {
    const menuUrl = new URL("/drinks", SITE).href;
    const deps = fakeDeps({ [menuUrl]: MENU });
    const outcome = await first([target({ ...PUB, website: null }, {
      siteUrl: SITE, discovered: true, addressBound: true, bindingUrl: SITE, pendingUrls: [menuUrl],
    })], deps, createCreditBudget(0.2));
    expect(outcome.rows).toHaveLength(5);
    expect(outcome.addressBound).toBe(true);
    expect(outcome.bindingUrl).toBe(SITE);
    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).toEqual([menuUrl]);
  });

  it("reads unresolved binding first and retains it for a one-page continuation", async () => {
    const menuUrl = new URL("/wine-list", SITE).href;
    const pub = { ...PUB, website: null };
    const deps = fakeDeps({ [SITE]: "The Feathers SE1 9AA", [menuUrl]: MENU });
    const partial = await first([target(pub, {
      siteUrl: SITE, discovered: true, bindingUrl: SITE, seedUrls: [menuUrl], pendingUrls: [menuUrl],
    })], deps, createCreditBudget(0.2));
    expect(partial.outcome).toBe("partial");
    expect(partial.addressBound).toBe(true);
    expect(partial.bindingUrl).toBe(SITE);
    expect(partial.pendingUrls).toEqual([menuUrl]);
    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).toEqual([SITE]);

    const retry = fakeDeps({ [menuUrl]: MENU });
    const complete = await first([target(pub, JSON.parse(JSON.stringify(partial)))], retry, createCreditBudget(0.2));
    expect(complete.outcome).toBe("priced");
    expect(complete.addressBound).toBe(true);
    expect(complete.bindingUrl).toBe(SITE);
    expect(complete.rows).toHaveLength(5);
    expect(retry.extract.mock.calls.flatMap(([urls]) => urls)).toEqual([menuUrl]);
  });

  it.each([false, true])("uses actual retained prices after unpriced menus complete: %s", async (priced) => {
    const urls = ["beer", "wine", "cocktails", "soft"].map((name) => new URL(`/drinks/${name}`, SITE).href);
    const deps = fakeDeps({
      [SITE]: "Welcome",
      ...Object.fromEntries(urls.map((url, index) => [url, priced && index === 0 ? MENU : UNPRICED_MENU])),
    }, { render: async (url: string) => ({ markdown: UNPRICED_MENU, links: [], finalUrl: url }) });
    const partial = await first([target(PUB, { seedUrls: urls })], deps, createCreditBudget(10));
    expect(partial.outcome).toBe("partial");
    expect(partial.priceKeys).toHaveLength(priced ? 5 : 0);
    const complete = await first([target(PUB, partial)], deps, createCreditBudget(10));
    expect(complete.pendingUrls).toEqual([]);
    expect(complete.outcome).toBe(priced ? "priced" : "no-menu-page-found");
    expect(complete.priceKeys).toHaveLength(priced ? 5 : 0);
    expect(complete.rows).toEqual([]);
  });

  it.each(["robots-disallowed", "policy-refused-host", "refused-by-site", "blocked-by-challenge", "redirect-refused"])(
    "records a definitive menu refusal without retrying it: %s", async (reason) => {
      const menuUrl = new URL("/drinks", SITE).href;
      const deps = fakeDeps({ [SITE]: HOME }, {
        siteLinks: async (url: string) => url === menuUrl ? { menu: [], contact: [], refusal: reason } : { menu: [], contact: [] },
        render: async (url: string) => ({ markdown: UNPRICED_MENU, links: [], finalUrl: url }),
      });
      const outcome = await first([target()], deps, createCreditBudget(10));
      expect(outcome.outcome).toBe(reason);
      expect(outcome.pendingUrls).toEqual([]);
      expect(outcome.completedUrls).not.toContain(menuUrl);
      expect(tavilyOutcomeNeedsRetry(outcome.outcome)).toBe(false);
      expect(outcome.refusals).toContainEqual({ url: menuUrl, reason });
    },
  );

  it.each(["robots-disallowed", "blocked-by-challenge"])("renders the homepage after %s to find a permitted PDF", async (reason) => {
    const refusedUrl = new URL("/wine-list", SITE).href;
    const pdfUrl = new URL("/drinks.pdf", SITE).href;
    const render = vi.fn(async (url: string) => ({
      markdown: url === refusedUrl ? "Just a moment... cf-browser-verification challenge-platform" : UNPRICED_MENU,
      links: url === refusedUrl ? [] : [pdfUrl], finalUrl: url,
    }));
    const readPdf = vi.fn(async (url: string) => ({ text: MENU, finalUrl: url }));
    const outcome = await first([target()], fakeDeps({ [SITE]: "[Wine list](/wine-list)", [refusedUrl]: "Loading wine..." }, {
      robots: async (url: string) => ({ allowed: reason !== "robots-disallowed" || url !== refusedUrl, reason: "robots-disallowed" }),
      render,
      readPdf,
    }), createCreditBudget(10));
    expect(render).toHaveBeenCalledWith(SITE);
    expect(readPdf).toHaveBeenCalledWith(pdfUrl);
    expect(outcome.outcome).toBe("priced");
    expect(outcome.rows).toHaveLength(5);
    expect(outcome.rows.every((row) => row.url === pdfUrl)).toBe(true);
    expect(outcome.pendingUrls).not.toContain(refusedUrl);
    expect(outcome.completedUrls).not.toContain(refusedUrl);
  });

  it("retries a render-dependent pub even when no static prices were read", async () => {
    const outcome = await first([target()], fakeDeps({ [SITE]: "Loading drinks..." }), createCreditBudget(10));
    expect(outcome.outcome).toBe("partial");
    expect(outcome.rows).toEqual([]);
    expect(tavilyOutcomeNeedsRetry(outcome.outcome)).toBe(true);
    expect(tavilyOutcomeNeedsRetry("budget-spent")).toBe(true);
  });

  it.each(["menu", "seed"])("renders the homepage when the %s could not be read", async (kind) => {
    const failedUrl = "https://thefeathers.co.uk/wine-list";
    const drinksUrl = "https://thefeathers.co.uk/drinks";
    const pub = kind === "seed" ? { ...PUB, website: null } : PUB;
    const render = vi.fn(async (url: string) => ({
      markdown: "The Feathers SE1 9AA. Our drinks", links: [drinksUrl], finalUrl: url,
    }));
    const deps = fakeDeps({
      [SITE]: "The Feathers SE1 9AA [Wine list](/wine-list)",
      [drinksUrl]: MENU,
    }, {
      render,
      search: async () => ({ results: [{ url: failedUrl, title: "", content: "" }], credits: 1 }),
    });
    const outcome = await first([target(pub)], deps, createCreditBudget(10));

    expect(render.mock.calls.map(([url]) => url)).toEqual([SITE]);
    expect(outcome.outcome).toBe("partial");
    expect(outcome.pendingUrls).toContain(failedUrl);
    expect(outcome.rows).toHaveLength(5);
    expect(outcome.rows.every((row) => row.url === drinksUrl)).toBe(true);
  });

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
    expect(render).not.toHaveBeenCalledWith(SITE);
    expect(outcome.outcome).toBe("partial");
    expect(outcome.pendingUrls).toEqual(["https://thefeathers.co.uk/wine-list"]);
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
    expect(outcome.pendingUrls).toEqual([]);
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
    const render = vi.fn(async (url: string) => ({ markdown: url.endsWith("/drinks") ? MENU : HOME, links: [], finalUrl: url }));
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
      render: via === "browserbase" ? async (url: string) => ({ markdown: UNPRICED_MENU, links: [pdfUrl], finalUrl: url }) : null,
    });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.outcome).toBe(via === "browserbase" ? "priced" : "partial");
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

  it.each(["html", "markdown", "browserbase"])("continues capped menus discovered through %s", async (via) => {
    const deps = fakeDeps({
      "https://thefeathers.co.uk/": "[Menus](/menus)",
      "https://thefeathers.co.uk/menus": via === "markdown" ? "[Drinks](/drinks) [Wine](/wine-list) [More](/cocktails)" : "Loading menus...",
      "https://thefeathers.co.uk/drinks": MENU,
      "https://thefeathers.co.uk/wine-list": MENU,
      "https://thefeathers.co.uk/cocktails": "# Cocktails\n- Margarita £12.00\n- Negroni £11.00\n- Mojito £10.50\n- Espresso Martini £12.50",
    }, {
      siteLinks: async (url: string) => siteLinksFromPage({
        ok: true, finalUrl: url,
        body: via === "html" && url.endsWith("/menus")
          ? '<a href="/drinks">Beer</a><a href="/wine-list">Wine</a><a href="/cocktails">Cocktails</a>' : "",
      }),
      render: async (url: string) => ({
        markdown: UNPRICED_MENU, finalUrl: url,
        links: via === "browserbase" ? ["/drinks", "/wine-list", "/cocktails"].map((part) => new URL(part, SITE).href) : [],
      }),
    });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.outcome).toBe("partial");
    expect(outcome.pages.filter((page) => page.kind === "menu" && page.via)).toHaveLength(3);
    expect(outcome.pendingUrls).toEqual(["https://thefeathers.co.uk/cocktails"]);
    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).not.toContain("https://thefeathers.co.uk/cocktails");
    const saved = JSON.parse(JSON.stringify(outcome)) as typeof outcome;
    const complete = await first([target(PUB, saved)], deps, createCreditBudget(10));
    expect(complete.outcome).toBe("priced");
    expect(complete.pendingUrls).toEqual([]);
    expect(complete.rows).toContainEqual(expect.objectContaining({ category: "cocktail", priceGbp: 12 }));
    expect(complete.completedUrls).toContain("https://thefeathers.co.uk/cocktails");
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

  it("retains partial extraction results and continues after credit exhaustion", async () => {
    const deps = fakeDeps({
      [SITE]: "[Beer](/drinks/beer) [Wine](/drinks/wine) [Soft drinks](/drinks/soft)",
      "https://thefeathers.co.uk/drinks/beer": MENU,
      "https://thefeathers.co.uk/drinks/wine": MENU,
      "https://thefeathers.co.uk/drinks/soft": MENU,
    });
    const budget = createCreditBudget(0.6);
    const outcome = await first([target()], deps, budget);

    expect(outcome.outcome).toBe("partial");
    expect(outcome.rows).toHaveLength(5);
    expect(outcome.pagesRead).toBe(3);
    expect(outcome.pendingUrls).toEqual(["https://thefeathers.co.uk/drinks/soft"]);
    expect(budget.spent).toBeCloseTo(0.6);

    const retried = await first([target(PUB, outcome)], deps, createCreditBudget(0.2));
    expect(retried.outcome).toBe("priced");
    expect(retried.pagesRead).toBe(1);
    expect(retried.pendingUrls).toEqual([]);
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
    expect(outcome.outcome).toBe("partial");
    expect(outcome.pendingUrls).toEqual([SITE]);
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
    expect(outcome.outcome).toBe("partial");
    expect(outcome.pendingUrls).toEqual([SITE]);
    expect(siteSearch).not.toHaveBeenCalled();
  });

  it("retains partial prices and page evidence when rendering is exhausted", async () => {
    const deps = fakeDeps({
      [SITE]: "[Drinks](/drinks) [Wine](/wine-list)",
      "https://thefeathers.co.uk/drinks": MENU,
      "https://thefeathers.co.uk/wine-list": "Loading wine...",
    }, {
      render: async (url: string) => ({ markdown: MENU, links: [], finalUrl: url }),
      renderBudget: { take: () => false },
    });
    const outcome = await first([target()], deps, createCreditBudget(10));
    expect(outcome.outcome).toBe("partial");
    expect(outcome.rows).toHaveLength(5);
    expect(outcome.pages).toHaveLength(3);
  });

  it("retries all rendered menus while retaining the first run's partial prices", async () => {
    let rendersLeft = 1;
    const render = vi.fn(async (url: string) => ({ markdown: MENU, links: [], finalUrl: url }));
    const deps = fakeDeps({
      [SITE]: "[Drinks](/drinks) [Wine](/wine-list)",
      "https://thefeathers.co.uk/drinks": "Loading drinks...",
      "https://thefeathers.co.uk/wine-list": "Loading wine...",
    }, {
      render,
      renderBudget: { take: () => rendersLeft > 0 && (rendersLeft -= 1, true) },
    });
    const partial = await first([target()], deps, createCreditBudget(1));
    expect(partial.outcome).toBe("partial");
    expect(partial.rendered).toBe(1);
    expect(partial.rows).toHaveLength(5);
    expect(partial.pages).toHaveLength(3);

    rendersLeft = 2;
    const complete = await first([target()], deps, createCreditBudget(1));
    expect(complete.outcome).toBe("priced");
    expect(complete.rendered).toBe(2);
    expect(complete.rows).toHaveLength(5);
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
  it("checks restored seeds against the host, robots and menu-page cap", async () => {
    const denied = "https://thefeathers.co.uk/drinks/private";
    const menuUrl = "https://thefeathers.co.uk/drinks/menu";
    const wineUrl = "https://thefeathers.co.uk/wine-list";
    const overflow = "https://thefeathers.co.uk/cocktails";
    const foreign = "https://other-pub.co.uk/drinks";
    const deps = fakeDeps({ [menuUrl]: `${MENU}\nSE1 9AA`, [wineUrl]: MENU }, {
      robots: async (url: string) => ({ allowed: url !== denied, reason: "robots-disallowed" }),
    });
    const outcome = await first([target({ ...PUB, website: null }, {
      siteUrl: SITE, discovered: true, seedUrls: [foreign, denied, menuUrl, wineUrl, overflow],
    })], deps, createCreditBudget(10));

    expect(outcome.outcome).toBe("partial");
    expect(outcome.seedUrls).toEqual([denied, menuUrl, wineUrl, overflow]);
    expect(outcome.pendingUrls).not.toContain(denied);
    expect(outcome.refusals).toContainEqual({ url: denied, reason: "robots-disallowed", evidence: "" });
    const extracted = deps.extract.mock.calls.flatMap(([urls]) => urls);
    expect(extracted).toContain(menuUrl);
    expect(extracted).toContain(wineUrl);
    expect(extracted).not.toContain(denied);
    expect(extracted).not.toContain(foreign);
    expect(extracted).not.toContain(overflow);
    expect(outcome.pendingUrls).toContain(overflow);
  });

  it.each(["discovery", "site-search"])("retains %s menu URLs across a render retry with a failed homepage", async (via) => {
    const menuUrl = `https://thefeathers.co.uk/${via === "discovery" ? "drinks" : "our-bar"}`;
    const pub = { ...PUB, website: via === "discovery" ? null : SITE };
    const searchResult = async () => ({
      results: [{ url: menuUrl, title: "The Feathers", content: "Guinness £6.40" }], credits: 1,
    });
    const partial = await first([target(pub)], fakeDeps({
      ...(via === "site-search" ? { [SITE]: "Welcome" } : {}),
      [menuUrl]: "The Feathers SE1 9AA. Loading drinks...",
    }, {
      search: searchResult,
      siteSearch: searchResult,
      render: async (url: string) => ({ markdown: MENU, links: [], finalUrl: url }),
      renderBudget: { take: () => false },
    }), createCreditBudget(10));

    expect(partial.outcome).toBe("partial");
    expect(partial.rows).toEqual([]);
    expect(partial.pages.length).toBeGreaterThan(0);
    expect(partial.seedUrls).toEqual([menuUrl]);

    const saved = JSON.parse(JSON.stringify(partial)) as typeof partial;
    const search = vi.fn();
    const siteSearch = vi.fn();
    const deps = fakeDeps({ [menuUrl]: `${MENU}\nSE1 9AA` }, { search, siteSearch });
    const complete = await first([target(pub, saved)], deps, createCreditBudget(1));

    expect(complete.outcome).toBe("priced");
    expect(complete.rows).toHaveLength(5);
    expect(complete.rows.every((row) => row.url === menuUrl)).toBe(true);
    expect(complete.addressBound).toBe(via === "discovery");
    expect(deps.robots).toHaveBeenCalledWith(menuUrl);
    expect(search).not.toHaveBeenCalled();
    expect(siteSearch).not.toHaveBeenCalled();
    expect(complete.pages.map((page) => page.url)).toEqual([menuUrl]);
    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).toEqual([menuUrl]);
  });

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
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["partial", "priced"]);
  });

  it("retains a discovery for a render retry and still requires address binding", async () => {
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
    expect(saved.outcome).toBe("partial");
    expect(saved.rows).toEqual([]);
    expect(saved.pages.length).toBeGreaterThan(0);
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

describe("durable Tavily continuation", () => {
  it.each(["unconfigured", "failed", "exhausted"])("keeps an unbound discovery partial when rendering is %s", async (mode) => {
    const menuUrl = new URL("/wine-list", SITE).href;
    const beerUrl = new URL("/drinks/beer", SITE).href;
    const pub = { ...PUB, website: null };
    const pages = {
      [SITE]: "Welcome [Beer](/drinks/beer)",
      [beerUrl]: "# Drinks\n## On draught\n- Peroni pint £6.50\n- Madri pint £6.30\n- Guinness pint £6.20\n- Neck Oil pint £6.80",
      [menuUrl]: "Loading drinks...",
    };
    const partial = await first([target(pub)], fakeDeps(pages, {
      search: async () => ({ results: [{ url: menuUrl, title: "", content: "" }], credits: 1 }),
      render: mode === "unconfigured" ? null : async () => { throw new Error("offline"); },
      renderBudget: { take: () => mode !== "exhausted" },
    }), createCreditBudget(10));
    expect(partial.outcome).toBe("partial");
    expect(partial.rows).toEqual([]);
    expect(partial.addressBound).toBe(false);
    expect(partial.pendingUrls).toContain(menuUrl);
    const complete = await first([target(pub, JSON.parse(JSON.stringify(partial)))], fakeDeps(pages, {
      render: async (url: string) => ({ markdown: `${MENU}\nSE1 9AA`, links: [], finalUrl: url }),
    }), createCreditBudget(10));
    expect(complete.outcome).toBe("priced");
    expect(complete.addressBound).toBe(true);
    expect(complete.rows).toHaveLength(9);
    expect(complete.rows).toContainEqual(expect.objectContaining({ drinkLabel: "Peroni pint", priceGbp: 6.50 }));
  });

  it.each(["discovery", "site-search", "restored", "html"])("continues all %s seeds across multiple runs", async (via) => {
    const urls = Array.from({ length: 8 }, (_, index) => new URL(`/drinks/${index}`, SITE).href);
    const results = urls.map((url) => ({ url, title: "", content: "" }));
    const pub = { ...PUB, website: via === "discovery" ? null : SITE };
    const deps = fakeDeps({ [SITE]: "Welcome", ...Object.fromEntries(urls.map((url) => [url, `${MENU}\nSE1 9AA`])) }, {
      search: async () => ({ results, credits: 1 }),
      siteSearch: async () => ({ results, credits: 1 }),
      siteLinks: async (url: string) => siteLinksFromPage({
        ok: true, finalUrl: url,
        body: via === "html" && url === SITE ? urls.map((href) => `<a href="${href}">Drinks</a>`).join("") : "",
      }),
    });
    let state = await first([target(pub, via === "restored" ? { seedUrls: urls } : {})], deps, createCreditBudget(10));
    expect(state.outcome).toBe("partial");
    expect(state.pendingUrls).toHaveLength(5);
    expect(state.seedUrls).toEqual(via === "html" ? [] : urls);
    for (let run = 0; run < 3; run += 1) {
      state = await first([target(pub, JSON.parse(JSON.stringify(state)))], deps, createCreditBudget(10));
    }
    expect(state.outcome).toBe("priced");
    expect(state.pendingUrls).toEqual([]);
    expect(state.completedUrls).toEqual(expect.arrayContaining(urls));
  });

  it("reads saved pending pages in order before fresh drinks seeds", async () => {
    const food = new URL("/menus/food-menu", SITE).href;
    const wine = new URL("/menus/wine-list", SITE).href;
    const fresh = new URL("/drinks/beer", SITE).href;
    const pendingUrls = [SITE, food, wine];
    const deps = fakeDeps(Object.fromEntries([...pendingUrls, fresh].map((url) => [url, MENU])));
    const outcome = await first([target(PUB, { pendingUrls, seedUrls: [fresh] })], deps, createCreditBudget(10));

    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).toEqual([...pendingUrls, fresh]);
    expect(outcome.pendingUrls).toEqual([]);
    expect(outcome.rows).toHaveLength(5);
  });

  it("reads deferred menus before repeating failed menus on the next run", async () => {
    const failed = ["beer", "wine", "cocktails"].map((drink) => new URL(`/drinks/${drink}`, SITE).href);
    const readable = ["menus", "tariff", "price-list"].map((name) => new URL(`/${name}`, SITE).href);
    const deps = fakeDeps({
      [SITE]: "Welcome", ...Object.fromEntries(readable.map((url) => [url, MENU])),
    }, {
      render: async (url: string) => ({ markdown: UNPRICED_MENU, links: [], finalUrl: url }),
    });
    const partial = await first([target(PUB, { seedUrls: [...failed, ...readable] })], deps, createCreditBudget(10));
    expect(partial.outcome).toBe("partial");
    expect(partial.rows).toEqual([]);
    expect(partial.pendingUrls.slice(0, 3)).toEqual(readable);
    deps.extract.mockClear();
    const continued = await first([target(PUB, JSON.parse(JSON.stringify(partial)))], deps, createCreditBudget(10));
    expect(deps.extract.mock.calls.flatMap(([urls]) => urls)).toEqual(readable);
    expect(continued.outcome).toBe("partial");
    expect(continued.completedUrls).toEqual(readable);
    expect(continued.rows).toHaveLength(5);
    expect(continued.pendingUrls).toEqual(failed);
  });

  it("appends observations without changing recorded history or duplicating a retry", async () => {
    const directory = mkdtempSync(path.join(process.cwd(), ".tavily-ledger-test-"));
    try {
      const files = ["local.jsonl", "published.jsonl"].map((name) => path.join(directory, name));
      const history = '{ "venueId": "venue-uk-n99", "category": "cocktail", "drinkLabel": "## Margarita", "priceGbp": 12, "observedAt": "2026-11-01" }\n';
      for (const file of files) writeFileSync(file, history);
      const beerUrl = new URL("/drinks", SITE).href;
      const wineUrl = new URL("/wine-list", SITE).href;
      const pages = { [SITE]: "[Beer](/drinks) [Wine](/wine-list)", [beerUrl]: MENU, [wineUrl]: "Loading wine..." };
      const partial = await first([target()], fakeDeps(pages), createCreditBudget(10));
      expect(partial.outcome).toBe("partial");
      expect(persistTavilyRows(files, [target()], [partial], "2026-11-21T00:00:00.000Z")).toBe(5);
      const firstBytes = files.map((file) => readFileSync(file, "utf8"));
      expect(persistTavilyRows(files, [target()], [partial], "2026-11-21T00:00:00.000Z")).toBe(0);
      expect(files.map((file) => readFileSync(file, "utf8"))).toEqual(firstBytes);
      const retry = await first([target(PUB, JSON.parse(JSON.stringify(partial)))], fakeDeps({
        ...pages, [wineUrl]: MENU.replace("£6.40", "£6.90"),
      }), createCreditBudget(10));
      expect(retry.outcome).toBe("priced");
      persistTavilyRows(files, [target()], [retry], "2026-11-22T00:00:00.000Z");
      for (const [index, file] of files.entries()) {
        const bytes = readFileSync(file, "utf8");
        expect(bytes.startsWith(defined(firstBytes[index]))).toBe(true);
        expect(bytes.startsWith(history)).toBe(true);
        const rows = bytes.trim().split("\n").map((line) => JSON.parse(line));
        expect(rows).toHaveLength(11);
        expect(rows.filter((row) => row.drinkLabel === "Guinness, pint")).toEqual([
          expect.objectContaining({ priceGbp: 6.40, observedAt: "2026-11-21T00:00:00.000Z" }),
          expect.objectContaining({ priceGbp: 6.90, observedAt: "2026-11-22T00:00:00.000Z" }),
        ]);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
