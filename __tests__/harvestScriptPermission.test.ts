// THE HARVEST CLIS ASK PERMISSION BEFORE THEY FETCH, AND ASK AGAIN WHERE THEY LANDED.
//
// Each case drives a real harvest CLI's own fetch path with a mocked `fetch`
// and a stub robots checker, so what is proved is what the script SENDS, not
// what a comment says it would. Nothing here reaches the network: every fetch
// is a `vi.fn`, and a test that would have fetched fails on its call list.
//
// The lanes covered, and the defect each case pins:
//   * scripts/harvest_chain_menu_prices.mjs - a sitemap <loc> is the host's
//     string, so it is put back through the chain allow-list; robots is asked
//     before the sitemap itself is read; a redirect off the chain drops the row,
//     and a refused redirect hop is never requested at all.
//   * scripts/lib/permittedHarvestFetch.mjs - each redirect hop is asked the
//     row's host, the fence and robots before it is requested.
//   * scripts/refresh_pint_price_observations.mjs - a non-first-party
//     aggregator with no sourcePolicy row is refused before the first request.
//   * scripts/harvest/run.mjs - the events and facts lanes read the landed URL
//     Firecrawl reports, and skip a refused landing.
//   * scripts/backfill_site_harvest_drink_labels.mjs - robots before the fetch,
//     the landing re-asked, and a PDF read as BYTES rather than a decoded string.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHarvestReporter } from "@/lib/harvest/runReport";
import { harvestSource, REFUSED_ESTATE_HOSTS, type HarvestSource } from "@/lib/harvest/sourcePolicy";
import { defined } from "@/__tests__/helpers/defined";

import { fetchText, harvestChainMenuPrices, menuPagesFor } from "../scripts/harvest_chain_menu_prices.mjs";
import { createPermittedFetch, HarvestRefusal } from "../scripts/lib/permittedHarvestFetch.mjs";
import { HARVEST_REDIRECT_HOP_LIMIT } from "@/lib/harvest/redirectChain";
import {
  collect as collectPintPrices,
  permittedPintPricesSource,
  PINT_PRICES_SOURCE_ID,
} from "../scripts/refresh_pint_price_observations.mjs";
import { harvestEvents, harvestFacts, scrapeLanding } from "../scripts/harvest/run.mjs";
import { fetchBody } from "../scripts/backfill_site_harvest_drink_labels.mjs";

const REFUSED_ESTATE = defined(REFUSED_ESTATE_HOSTS[0]);

type FakeResponse = {
  ok: boolean;
  status: number;
  url: string;
  headers: Headers;
  body: null;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function respond(
  body: string | Uint8Array,
  { url, status = 200, type = "text/html" }: { url: string; status?: number; type?: string },
): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ "content-type": type }),
    body: null,
    text: async () => (typeof body === "string" ? body : Buffer.from(body).toString("latin1")),
    arrayBuffer: async () => {
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };
}

/** A redirect answer, as a fetch with `redirect: "manual"` hands it back. */
function redirectTo(location: string, { url, status = 302 }: { url: string; status?: number }): FakeResponse {
  return { ...respond("", { url, status }), headers: new Headers({ location }) };
}

/** A fetch that answers from a table and records every URL it was asked for. */
function fetchFrom(pages: Record<string, (url: string) => FakeResponse>) {
  // Typed as a fetch, so a case can read the redirect mode each request carried.
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const page = pages[url];
    if (!page) throw new Error(`unexpected fetch ${url}`);
    return page(url) as unknown as Response;
  });
}

const allowAll = vi.fn(async (url: string) => ({ allowed: true, reason: "allowed", evidence: `${url} permitted` }));
const refuseAll = vi.fn(async (url: string) => ({
  allowed: false,
  reason: "robots-disallowed",
  evidence: `${url} disallowed`,
}));

const noSleep = async () => {};

let typesafeKey: string | undefined;
beforeEach(() => {
  // The chain lane calls a model when this is set; these cases are keyless.
  typesafeKey = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  allowAll.mockClear();
  refuseAll.mockClear();
});
afterEach(() => {
  if (typesafeKey !== undefined) process.env.TYPESAFE_API_KEY = typesafeKey;
});

// ---------------------------------------------------------------------------
// scripts/harvest_chain_menu_prices.mjs
// ---------------------------------------------------------------------------

const STONEGATE = defined(harvestSource("stonegate-menu-prices"));
const SITEMAP = STONEGATE.url;
const OWN_MENU = "https://www.slugandlettuce.co.uk/menus/canary-wharf";
const MENU_HTML = "<html><body><h2>Draught</h2><p>Camden Hells Lager pint £6.20</p></body></html>";

function sitemapListing(...locs: string[]): string {
  return `<?xml version="1.0"?><urlset>${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join("")}</urlset>`;
}

describe("chain menu prices: the sitemap is the host's string", () => {
  it("never fetches a sitemap entry outside the chain's own allow-list", async () => {
    const fetchImpl = fetchFrom({
      [SITEMAP]: (url) =>
        respond(sitemapListing(OWN_MENU, "https://elsewhere.example/menu", `https://${REFUSED_ESTATE}/menu`), {
          url,
          type: "application/xml",
        }),
      [OWN_MENU]: (url) => respond(MENU_HTML, { url }),
    });

    const { report } = await harvestChainMenuPrices({
      sources: [STONEGATE],
      fetchImpl,
      robots: allowAll,
      sleepImpl: noSleep,
      pageBudget: 10,
    });

    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([SITEMAP, OWN_MENU]);
    expect(report.drops["off-source-allow-list"]).toBe(2);
  });

  it("asks robots before it reads the sitemap, and a refusal fetches nothing", async () => {
    const fetchImpl = fetchFrom({});
    const listed = await menuPagesFor(STONEGATE, () => true, { robots: refuseAll, fetchImpl });

    expect(refuseAll).toHaveBeenCalledWith(SITEMAP);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(listed.pages).toEqual([]);
    expect(listed.refusal?.reason).toBe("robots-disallowed");

    const { report } = await harvestChainMenuPrices({
      sources: [STONEGATE],
      fetchImpl,
      robots: refuseAll,
      sleepImpl: noSleep,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(report.sourcesSkipped).toContainEqual(
      expect.objectContaining({ id: STONEGATE.id, reason: "robots-disallowed" }),
    );
  });

  it("drops a row whose page redirected to another host", async () => {
    const fetchImpl = fetchFrom({
      [SITEMAP]: (url) => respond(sitemapListing(OWN_MENU), { url, type: "application/xml" }),
      // Same priced document, but the host chose a last hop off the chain.
      [OWN_MENU]: () => respond(MENU_HTML, { url: "https://another-host.example/menus/canary-wharf" }),
    });

    const { rows, report } = await harvestChainMenuPrices({
      sources: [STONEGATE],
      fetchImpl,
      robots: allowAll,
      sleepImpl: noSleep,
    });

    expect(rows).toEqual([]);
    expect(report.drops["redirect-left-source"]).toBe(1);
  });
});

describe("chain menu prices: a redirect hop is asked before it is sent", () => {
  const fetchedUrls = (fetchImpl: ReturnType<typeof fetchFrom>) => fetchImpl.mock.calls.map(([url]) => String(url));

  it("never requests a 302 target off the chain's allow-list", async () => {
    const offChain = `https://${REFUSED_ESTATE}/menus/canary-wharf`;
    const fetchImpl = fetchFrom({
      [SITEMAP]: (url) => respond(sitemapListing(OWN_MENU), { url, type: "application/xml" }),
      [OWN_MENU]: (url) => redirectTo(offChain, { url }),
      [offChain]: (url) => respond(MENU_HTML, { url }),
    });

    const { rows, report } = await harvestChainMenuPrices({
      sources: [STONEGATE],
      fetchImpl,
      robots: allowAll,
      sleepImpl: noSleep,
    });

    expect(fetchedUrls(fetchImpl)).toEqual([SITEMAP, OWN_MENU]);
    expect(fetchImpl.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    expect(rows).toEqual([]);
    expect(report.drops["redirect-left-source"]).toBe(1);
  });

  it("never requests a hop that robots disallows, even on the chain's own host", async () => {
    const disallowed = "https://www.slugandlettuce.co.uk/private/canary-wharf";
    const robots = vi.fn(async (url: string) =>
      url === disallowed
        ? { allowed: false, reason: "robots-disallowed", evidence: `${url} disallowed` }
        : { allowed: true, reason: "allowed", evidence: `${url} permitted` },
    );
    const fetchImpl = fetchFrom({
      [SITEMAP]: (url) => respond(sitemapListing(OWN_MENU), { url, type: "application/xml" }),
      [OWN_MENU]: (url) => redirectTo("/private/canary-wharf", { url, status: 301 }),
      [disallowed]: (url) => respond(MENU_HTML, { url }),
    });

    const { rows, report } = await harvestChainMenuPrices({
      sources: [STONEGATE],
      fetchImpl,
      robots,
      sleepImpl: noSleep,
    });

    expect(robots).toHaveBeenCalledWith(disallowed);
    expect(fetchedUrls(fetchImpl)).toEqual([SITEMAP, OWN_MENU]);
    expect(rows).toEqual([]);
    expect(report.drops["redirect-robots-refused"]).toBe(1);
  });

  it("follows a permitted hop and stamps the row with the page that stated the price", async () => {
    const moved = "https://www.slugandlettuce.co.uk/menus/canary-wharf/";
    const fetchImpl = fetchFrom({
      [SITEMAP]: (url) => respond(sitemapListing(OWN_MENU), { url, type: "application/xml" }),
      [OWN_MENU]: (url) => redirectTo(moved, { url, status: 308 }),
      [moved]: (url) => respond(MENU_HTML, { url }),
    });

    const { rows } = await harvestChainMenuPrices({
      sources: [STONEGATE],
      fetchImpl,
      robots: allowAll,
      sleepImpl: noSleep,
    });

    expect(allowAll).toHaveBeenCalledWith(moved);
    expect(fetchedUrls(fetchImpl)).toEqual([SITEMAP, OWN_MENU, moved]);
    expect(rows).toEqual([expect.objectContaining({ url: moved, priceGbp: 6.2 })]);
  });
});

describe.each([
  { lane: "menu", refusedUrl: OWN_MENU },
  { lane: "sitemap", refusedUrl: SITEMAP },
])("chain $lane redirect refusal reporting", ({ refusedUrl }) => {
  it.each([
    { failure: "same-host loop", location: refusedUrl, reason: "redirect-hop-limit", requests: HARVEST_REDIRECT_HOP_LIMIT + 1 },
    { failure: "invalid Location", location: "http://[", reason: "redirect-unreadable", requests: 1 },
    { failure: "off-source target", location: "https://another-host.example/menu", reason: "redirect-left-source", requests: 1 },
  ])("counts $failure as $reason", async ({ location, reason, requests }) => {
    const fetchImpl = fetchFrom({
      [SITEMAP]: (url) => respond(sitemapListing(OWN_MENU), { url, type: "application/xml" }),
      [refusedUrl]: (url) => redirectTo(location, { url }),
    });

    const { rows, report } = await harvestChainMenuPrices({
      sources: [STONEGATE],
      fetchImpl,
      robots: allowAll,
      sleepImpl: noSleep,
    });

    expect(rows).toEqual([]);
    expect(report.drops).toEqual({ [reason]: 1 });
    const requestedUrls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(requestedUrls.filter((url) => url === refusedUrl)).toHaveLength(requests);
    expect(requestedUrls.every((url) => url === SITEMAP || url === refusedUrl)).toBe(true);
  });
});

describe("chain menu prices: a typed caller supplies the robots checker", () => {
  // The declaration once omitted `robots` from fetchText's options, so a
  // caller that followed it could not pass the checker, and an allowed
  // redirect failed with "robots is not a function". These cases type-check
  // against scripts/harvest_chain_menu_prices.d.mts and read the refusal
  // reasons it declares.
  it("follows a permitted hop through the checker it was handed", async () => {
    const moved = "https://www.slugandlettuce.co.uk/menus/canary-wharf/";
    const fetchImpl = fetchFrom({
      [OWN_MENU]: (url) => redirectTo(moved, { url, status: 301 }),
      [moved]: (url) => respond(MENU_HTML, { url }),
    });

    const page = await fetchText(OWN_MENU, { sourceId: STONEGATE.id, robots: allowAll, fetchImpl });

    expect(allowAll).toHaveBeenCalledWith(moved);
    expect(page).toMatchObject({ ok: true, landedUrl: moved, body: MENU_HTML });
  });

  it("names the refusal reason on the page and on the sitemap listing", async () => {
    const disallowed = "https://www.slugandlettuce.co.uk/private/sitemap.xml";
    const robots = vi.fn(async (url: string) =>
      url === disallowed
        ? { allowed: false, reason: "robots-disallowed", evidence: `${url} disallowed` }
        : { allowed: true, reason: "allowed", evidence: `${url} permitted` },
    );
    const fetchImpl = fetchFrom({ [SITEMAP]: (url) => redirectTo(disallowed, { url }) });

    const page = await fetchText(SITEMAP, { sourceId: STONEGATE.id, robots, fetchImpl });
    expect(page.ok).toBe(false);
    expect(page.reason).toBe("redirect-robots-refused");

    const listed = await menuPagesFor(STONEGATE, () => true, { robots, fetchImpl });
    expect(listed.pages).toEqual([]);
    expect(listed.reason).toBe("redirect-robots-refused");
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).not.toContain(disallowed);
  });
});

describe("permitted harvest fetch: a redirect hop is asked before it is sent", () => {
  const fetchedUrls = (fetchImpl: ReturnType<typeof fetchFrom>) => fetchImpl.mock.calls.map(([url]) => String(url));

  it("never requests a 302 target off the row's own host", async () => {
    const offHost = "https://another-host.example/menus/canary-wharf";
    const fetchImpl = fetchFrom({
      [OWN_MENU]: (url) => redirectTo(offHost, { url }),
      [offHost]: (url) => respond(MENU_HTML, { url }),
    });
    const permittedFetch = createPermittedFetch({ source: STONEGATE, fetchImpl, robots: allowAll });

    await expect(permittedFetch(OWN_MENU)).rejects.toThrow(HarvestRefusal);
    expect(fetchedUrls(fetchImpl)).toEqual([OWN_MENU]);
    expect(allowAll).not.toHaveBeenCalledWith(offHost);
  });

  it("never requests a hop that robots disallows", async () => {
    const disallowed = "https://www.slugandlettuce.co.uk/private/";
    const robots = vi.fn(async (url: string) =>
      url === disallowed
        ? { allowed: false, reason: "robots-disallowed", evidence: `${url} disallowed` }
        : { allowed: true, reason: "allowed", evidence: `${url} permitted` },
    );
    const fetchImpl = fetchFrom({
      [OWN_MENU]: (url) => redirectTo(disallowed, { url, status: 307 }),
      [disallowed]: (url) => respond(MENU_HTML, { url }),
    });
    const permittedFetch = createPermittedFetch({ source: STONEGATE, fetchImpl, robots });

    await expect(permittedFetch(OWN_MENU)).rejects.toThrow(/REFUSED .*private.*disallowed/);
    expect(fetchedUrls(fetchImpl)).toEqual([OWN_MENU]);
  });

  it("stops a redirect loop at the hop limit", async () => {
    const other = "https://www.slugandlettuce.co.uk/menus/canary-wharf/";
    const fetchImpl = fetchFrom({
      [OWN_MENU]: (url) => redirectTo(other, { url }),
      [other]: (url) => redirectTo(OWN_MENU, { url }),
    });
    const permittedFetch = createPermittedFetch({ source: STONEGATE, fetchImpl, robots: allowAll });

    await expect(permittedFetch(OWN_MENU)).rejects.toThrow(/redirected more than 5 times/);
    expect(fetchImpl).toHaveBeenCalledTimes(HARVEST_REDIRECT_HOP_LIMIT + 1);
  });

  it("returns the page a permitted hop led to", async () => {
    const moved = "https://www.slugandlettuce.co.uk/menus/canary-wharf/";
    const fetchImpl = fetchFrom({
      [OWN_MENU]: (url) => redirectTo(moved, { url, status: 301 }),
      [moved]: (url) => respond(MENU_HTML, { url }),
    });
    const permittedFetch = createPermittedFetch({ source: STONEGATE, fetchImpl, robots: allowAll });

    const response = await permittedFetch(OWN_MENU, { redirect: "follow" });
    expect(await response.text()).toBe(MENU_HTML);
    expect(fetchedUrls(fetchImpl)).toEqual([OWN_MENU, moved]);
    // A caller cannot turn automatic following back on.
    expect(fetchImpl.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scripts/refresh_pint_price_observations.mjs
// ---------------------------------------------------------------------------

describe("pint-prices.com: a non-first-party aggregator needs a policy row", () => {
  it("has no allowed sourcePolicy row today, so it refuses before any fetch", async () => {
    expect(harvestSource(PINT_PRICES_SOURCE_ID)).toBeUndefined();
    expect(() => permittedPintPricesSource()).toThrow(/nonFirstPartyException.*captain's call/);

    const fetchImpl = vi.fn();
    await expect(collectPintPrices({ fetchImpl, robots: allowAll, sleepImpl: noSleep })).rejects.toThrow(
      /Nothing was fetched/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(allowAll).not.toHaveBeenCalled();
  });

  const ROW: HarvestSource = {
    id: PINT_PRICES_SOURCE_ID,
    label: "test-only row",
    url: "https://www.pint-prices.com/",
    kind: "chain-menu-prices",
    firstParty: false,
    nonFirstPartyException: "test-only: stated pint prices, nothing else",
    access: { allowed: true, evidence: "test", checkedOn: "2026-10-16" },
    notes: "test-only",
  };

  it("refuses an allowed row that states no nonFirstPartyException", async () => {
    const fetchImpl = vi.fn();
    const withoutException: HarvestSource = { ...ROW };
    delete withoutException.nonFirstPartyException;
    await expect(
      collectPintPrices({ source: withoutException, fetchImpl, robots: allowAll, sleepImpl: noSleep }),
    ).rejects.toThrow(/states no nonFirstPartyException/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks robots live, and a refusal fetches nothing", async () => {
    const fetchImpl = vi.fn();
    await expect(
      collectPintPrices({ source: ROW, fetchImpl, robots: refuseAll, sleepImpl: noSleep }),
    ).rejects.toThrow(/robots\.txt refuses/);
    expect(refuseAll).toHaveBeenCalledWith("https://www.pint-prices.com/static/sitemap.xml");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads only the source's own host, under our own name", async () => {
    const sitemapUrl = "https://www.pint-prices.com/static/sitemap.xml";
    const borough = "https://www.pint-prices.com/borough-results/camden";
    const fetchImpl = fetchFrom({
      [sitemapUrl]: (url) =>
        respond(sitemapListing(borough, "https://elsewhere.example/pub/red-lion"), { url, type: "application/xml" }),
      [borough]: (url) => respond("<html></html>", { url }),
    });

    await collectPintPrices({ source: ROW, fetchImpl, robots: allowAll, sleepImpl: noSleep });

    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([sitemapUrl, borough]);
    for (const [, init] of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      const agent = String((init.headers as Record<string, string>)["user-agent"]);
      expect(agent).toContain("pubmaxxing.com");
      expect(agent).not.toContain("pint-prices.com");
    }
  });
});

// ---------------------------------------------------------------------------
// scripts/harvest/run.mjs
// ---------------------------------------------------------------------------

type ScrapeCall = { url: string };

function fakeClient(pages: Record<string, { markdown: string; landedUrl: string | null }>, searchHits: string[] = []) {
  const calls: ScrapeCall[] = [];
  return {
    calls,
    client: {
      scrape: async (url: string) => {
        calls.push({ url });
        const page = pages[url];
        if (!page) throw new Error(`unexpected scrape ${url}`);
        return {
          ok: true as const,
          page: { url, landedUrl: page.landedUrl, markdown: page.markdown, statusCode: 200, cacheState: null, cachedAt: null },
        };
      },
      search: async () => ({ ok: true as const, results: searchHits.map((url) => ({ url })) }),
    },
  };
}

const OBSERVED_AT = "2026-10-16T12:00:00.000Z";

function dropsOf(reporter: ReturnType<typeof createHarvestReporter>, sourceId: string): string[] {
  const outcome = reporter.outcomes().find((row) => row.sourceId === sourceId);
  return (outcome?.drops ?? []).map((drop) => drop.reason);
}

describe("London harvest lanes read where Firecrawl landed", () => {
  it("scrapeLanding refuses a landing on a refused estate and re-asks robots on a moved one", async () => {
    expect(await scrapeLanding("https://redlion.example/", { landedUrl: `https://${REFUSED_ESTATE}/` }, allowAll)).toEqual({
      ok: false,
      reason: "redirect-refused",
    });
    expect(
      await scrapeLanding("https://redlion.example/", { landedUrl: "https://redlion.example/home" }, refuseAll),
    ).toEqual({ ok: false, reason: "redirect-robots-refused" });
    expect(await scrapeLanding("https://redlion.example/", { landedUrl: null }, refuseAll)).toEqual({
      ok: true,
      url: "https://redlion.example/",
    });
  });

  it("events lane: a home page that landed on a refused host is skipped, and nothing more is read", async () => {
    const website = "https://redlion.example/";
    const { client, calls } = fakeClient({
      [website]: { markdown: "[What's on](/whats-on)", landedUrl: `https://${REFUSED_ESTATE}/` },
    });
    const reporter = createHarvestReporter({ mode: "cli", startedAt: OBSERVED_AT });

    const result = await harvestEvents({
      client,
      reporter,
      robots: allowAll,
      observedAt: OBSERVED_AT,
      nowMs: Date.parse(OBSERVED_AT),
      venueIndex: null,
      dryRun: true,
      venueLimit: 1,
      fresh: false,
      venues: [{ name: "Red Lion", address: "1 High St, London N1 1AA", website, lat: null, lng: null }],
      samePauseMs: 0,
    });

    expect(result.rows).toBe(0);
    expect(calls.map((call) => call.url)).toEqual([website]);
    expect(dropsOf(reporter, "venue-own-pages")).toContain("redirect-refused");
  });

  it("events lane: a what's-on page that landed on a refused host is skipped", async () => {
    const website = "https://redlion.example/";
    const eventsUrl = "https://redlion.example/whats-on";
    const { client, calls } = fakeClient({
      [website]: { markdown: "[What's on](/whats-on)", landedUrl: website },
      [eventsUrl]: { markdown: "Quiz night every Tuesday 8pm", landedUrl: `https://${REFUSED_ESTATE}/events` },
    });
    const reporter = createHarvestReporter({ mode: "cli", startedAt: OBSERVED_AT });

    await harvestEvents({
      client,
      reporter,
      robots: allowAll,
      observedAt: OBSERVED_AT,
      nowMs: Date.parse(OBSERVED_AT),
      venueIndex: null,
      dryRun: true,
      venueLimit: 1,
      fresh: false,
      venues: [{ name: "Red Lion", address: "1 High St, London N1 1AA", website, lat: null, lng: null }],
      samePauseMs: 0,
    });

    expect(calls.map((call) => call.url)).toEqual([website, eventsUrl]);
    expect(dropsOf(reporter, "venue-own-pages")).toContain("redirect-refused");
    const outcome = reporter.outcomes().find((row) => row.sourceId === "venue-own-pages");
    expect(outcome?.evidence).toContain("0 published a what's-on page");
  });

  it("facts lane: an operator page that landed on a refused host is skipped before it is used", async () => {
    const operator = "https://redlionbarnes.co.uk/";
    const venues = [{ name: "The Red Lion", address: "1 High St, London SW13 9AA", lat: null, lng: null }];
    const run = async (landedUrl: string) => {
      const { client } = fakeClient({ [operator]: { markdown: "Open daily 12pm to 11pm", landedUrl } }, [operator]);
      const reporter = createHarvestReporter({ mode: "cli", startedAt: OBSERVED_AT });
      await harvestFacts({
        client,
        reporter,
        robots: allowAll,
        observedAt: OBSERVED_AT,
        venueIndex: null,
        dryRun: true,
        venueLimit: 1,
        fresh: false,
        venues,
        venuePaceMs: 0,
      });
      return dropsOf(reporter, "operator-pages");
    };

    expect(await run(`https://${REFUSED_ESTATE}/`)).toEqual(["redirect-refused"]);
    // The control: the same page landing at home reaches the next gate.
    expect(await run(operator)).toEqual(["venue-unresolved"]);
  });
});

// ---------------------------------------------------------------------------
// scripts/backfill_site_harvest_drink_labels.mjs
// ---------------------------------------------------------------------------

/** The smallest valid PDF with a text layer (the harvestPdfText.test.ts fixture). */
function pdfStating(lines: readonly string[]): Uint8Array {
  const stream = `BT /F1 12 Tf 40 760 Td 14 TL\n${lines
    .map((line) => `(${line.replace(/([()\\])/g, "\\$1")}) Tj T*`)
    .join("\n")}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join("\n")}\n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

describe("drink label backfill: permission first, and a PDF is bytes", () => {
  const MENU_PDF = "https://redlion.example/drinks.pdf";

  it("reads a PDF menu through the bytes path", async () => {
    const bytes = pdfStating(["Red Lion Drinks", "Neck Oil Session IPA pint 6.20"]);
    const fetchImpl = fetchFrom({ [MENU_PDF]: (url) => respond(bytes, { url, type: "application/pdf" }) });

    const fetched = await fetchBody(MENU_PDF, { fetchImpl, robots: allowAll });

    expect(fetched.ok).toBe(true);
    expect(fetched.sourceFormat).toBe("text");
    expect(fetched.body).toContain("Neck Oil Session IPA");
  });

  it("asks robots first, and a refusal fetches nothing", async () => {
    const fetchImpl = vi.fn();
    const fetched = await fetchBody(MENU_PDF, { fetchImpl, robots: refuseAll });
    expect(fetched).toMatchObject({ ok: false, reason: "robots-disallowed" });
    expect(refuseAll).toHaveBeenCalledWith(MENU_PDF);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops a page whose redirect landed on a refused host", async () => {
    const page = "https://redlion.example/menu";
    const fetchImpl = fetchFrom({ [page]: () => respond("<p>Guinness pint £6.80</p>", { url: `https://${REFUSED_ESTATE}/menu` }) });
    const fetched = await fetchBody(page, { fetchImpl, robots: allowAll });
    expect(fetched).toMatchObject({ ok: false, reason: "redirect-refused" });
  });
});
