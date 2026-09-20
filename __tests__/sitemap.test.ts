import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { execFileSync } from "node:child_process";
import { promises as fs } from "fs";
import path, { join } from "path";

import registry from "@/data/freshness_registry.json";
import sitemap from "@/app/sitemap";
import { listEnabledCities } from "@/lib/cities";
import { listBoroughs } from "@/lib/boroughs";
import { landmarks } from "@/lib/landmarks";
import { loadHistoricPubs } from "@/lib/historic";
import { SEED_BOROUGH_MONTHLY_TARGET } from "@/lib/boroughCoverageStatus";
import { validatePintIndexSnapshot, type PintIndexSnapshot } from "@/lib/pintIndex";
import { loadPintIndexArchive } from "@/lib/pintIndexSnapshot.server";
import {
  DRINK_BRAND_LANDING_CATALOG,
  buildDrinkBrandLanding,
} from "@/lib/drinkBrandLanding";
import { loadDrinkBrandLandings } from "@/lib/drinkBrandLanding.server";
import { loadDrinkBrandAreaLandings } from "@/lib/drinkBrandAreaLanding.server";
import { PERFORMANCE_BUDGETS } from "@/lib/performanceBudgets";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import type { MetadataRoute } from "next";

// The number of UNCONDITIONAL static hub URLs the generator emits while Social
// is gated (the fixed list in app/sitemap.ts minus /social). Kept here so a
// change to that list is a conscious test edit. Includes /about (founder story
// + press kit hub), /founders (the numbered public wall of the first hundred
// claimed handles), the two legal content pages (/privacy, /terms) linked from
// the site footer, and /account/delete, the public account-deletion page Play
// Console holds in its Data safety form and expects to be able to open, and
// /spoons-value, the national Wetherspoon units-per-tenner ranking.
//
// /pint-index is NOT here. Captain decision D10 holds its row until a month
// carries the admission floor of priced pubs in at least one borough, and the
// shipped snapshot carries none, so the generator emits no hub row today. The
// row returning is a conscious test edit, the same as a change to the list
// above; the gate itself is proved in both directions by the fixture-driven
// describe at the foot of this file. The ROUTE is unaffected either way.
const STATIC_HUB_COUNT = 15;

// Wave S1.2 — sitemap sanity. Runs the real generator against the bundled
// dataset (process.cwd() is the repo root in tests, so public/data/*.json is
// read for real). Asserts the shape and, critically, that NO token/UGC/auth
// surface ever leaks into the sitemap.

const SITE = "https://pubmaxxing.com";

// Every prefix app/robots.ts disallows must be absent from the sitemap.
const FORBIDDEN_SUBSTRINGS = [
  "/api/",
  "/admin",
  "/p/",
  "/rounds/",
  "/plan/",
  "/bar-tab/",
  "/messages",
  "/profile",
  "/activity",
  "/auth",
  "/discover",
  "/drinks",
  "/feed",
  "/stories",
];

// Query strings carry map/crawl tokens; a sitemap URL must be a bare canonical.
// Expected per-family counts, derived from the SAME data sources the generator
// reads — so the test detects real coverage loss (a shrunken dataset, a dropped
// family) without hard-coding a brittle magic total.
type ExpectedCounts = {
  cities: number;
  boroughs: number;
  landmarks: number;
  historic: number;
  venues: number;
  editions: number;
  drinkBrands: number;
  drinkBrandAreas: number;
  total: number;
};

async function expectedCounts(): Promise<ExpectedCounts> {
  const file = path.join(
    process.cwd(),
    "public",
    "data",
    "pint_prices_app_dataset.json",
  );
  const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
  const venues = groupVenuePrices(rows);
  const cities = listEnabledCities().filter((c) => c.id !== "london").length;
  const boroughs = listBoroughs(venues).length;
  const historic = (await loadHistoricPubs()).length;
  // One URL per dated Pint Index edition actually published. A frozen month is
  // a real citation whatever the live month holds, so D10 never touches these.
  const editions = (await loadPintIndexArchive()).length;
  // Governed landing pages come from the SAME loaders the routes render, so a
  // page the sitemap advertises is a page that exists.
  const drinkBrands = (await loadDrinkBrandLandings()).length;
  const drinkBrandAreas = (await loadDrinkBrandAreaLandings()).length;
  const counts = {
    cities,
    boroughs,
    landmarks: landmarks.length,
    historic,
    venues: venues.length,
    editions,
    drinkBrands,
    drinkBrandAreas,
  };
  return {
    ...counts,
    total:
      STATIC_HUB_COUNT +
      counts.cities +
      counts.boroughs +
      counts.landmarks +
      counts.historic +
      counts.venues +
      counts.editions +
      counts.drinkBrands +
      counts.drinkBrandAreas,
  };
}

describe("sitemap()", () => {
  let entries: MetadataRoute.Sitemap;
  let urls: string[];
  let expected: ExpectedCounts;

  const familyCount = (prefix: string) =>
    urls.filter((u) => u.startsWith(`${SITE}${prefix}`)).length;

  beforeAll(async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");
    entries = await sitemap();
    urls = entries.map((e) => e.url);
    expected = await expectedCounts();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("emits exactly the dataset-derived total (no silent coverage loss)", () => {
    expect(entries.length).toBe(expected.total);
  });

  it("lists every dated Pint Index edition, whatever the live month holds", () => {
    expect(familyCount("/pint-index/")).toBe(expected.editions);
    expect(expected.editions).toBeGreaterThan(0);
  });

  // D10: the shipped snapshot is empty, so the hub row is held. The route is
  // still SERVED and still linked; only its row and its index directive follow
  // the floor. Both directions of the rule are proved by the fixture-driven
  // describe at the foot of this file.
  it("holds the live Pint Index hub while the shipped month is empty", () => {
    expect(urls).not.toContain(`${SITE}/pint-index`);
  });

  it("includes the core static hubs", () => {
    for (const hub of [
      "/",
      "/map",
      "/borough",
      "/historic",
      "/crawls",
      "/about",
      "/spoons-value",
    ]) {
      expect(urls).toContain(`${SITE}${hub}`);
    }
  });

  it("lists the brand-relevant discovery routes a stranger can be sent to", () => {
    for (const hub of ["/", "/map", "/tonight", "/about", "/how-we-estimate"]) {
      expect(urls).toContain(`${SITE}${hub}`);
    }
  });

  it("advertises no /near page, because /near ships noindex", () => {
    // /near is a per-user, location-dependent view and carries
    // `robots: { index: false }` (app/near/page.tsx). A sitemap row for a
    // noindex URL is a contradictory signal: Search Console reports it as
    // "Submitted URL marked noindex" rather than indexing it. The borough
    // pages carry the indexable price content, and they are listed below.
    expect(urls).not.toContain(`${SITE}/near`);
    expect(urls).toContain(`${SITE}/borough`);
  });

  it("publishes the city picker once, at /places, and never at /choose-city", () => {
    // ONE picker, and the page the sitemap names is the page the canonical
    // names (app/places/page.tsx). /choose-city 308s here, so a row for it
    // would advertise a redirect and split the city list over two addresses.
    expect(urls.filter((url) => url === `${SITE}/places`).length).toBe(1);
    expect(urls).not.toContain(`${SITE}/choose-city`);
  });

  it("omits /social while the friends launch flag is off", () => {
    expect(urls).not.toContain(`${SITE}/social`);
  });

  it("emits the promised count for every dynamic family", () => {
    expect(familyCount("/map/")).toBe(expected.cities);
    expect(familyCount("/borough/")).toBe(expected.boroughs);
    expect(familyCount("/landmark/")).toBe(expected.landmarks);
    expect(familyCount("/historic/")).toBe(expected.historic);
    expect(familyCount("/ledger/")).toBe(expected.venues);
    expect(familyCount("/drink/")).toBe(expected.drinkBrands);
    expect(familyCount("/area/")).toBe(expected.drinkBrandAreas);
    expect(expected.drinkBrands).toBeGreaterThan(0);
    expect(expected.drinkBrandAreas).toBeGreaterThan(0);
    // Sanity floors so a "0 expected" (dataset wipe) can't make the test pass.
    expect(expected.boroughs).toBeGreaterThan(0);
    expect(expected.historic).toBeGreaterThan(0);
    expect(expected.venues).toBeGreaterThan(0);
  });

  it("advertises only the catalogue brands that clear their own floor", async () => {
    // The catalogue decides what MAY publish; PRICED_LANDING_PUBLICATION_FLOORS
    // decides what does. Both halves matter, so walk every catalogue brand and
    // check the sitemap against the loader's own verdict for it.
    const venues = groupVenuePrices(
      JSON.parse(
        await fs.readFile(
          path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json"),
          "utf8",
        ),
      ) as VenuePrice[],
    );
    let below = 0;

    for (const brand of DRINK_BRAND_LANDING_CATALOG) {
      const url = `${SITE}/drink/${encodeURIComponent(brand.id)}`;
      if (buildDrinkBrandLanding(brand.id, venues)) {
        expect(urls, `${brand.id} publishes but is unadvertised`).toContain(url);
        continue;
      }
      below += 1;
      expect(urls, `${brand.id} is below the floor but advertised`).not.toContain(url);
      // A brand with no London page has no area children either, so its crumb
      // can never point at a 404 under dynamicParams = false.
      expect(
        urls.filter((candidate) => candidate.endsWith(`/drink/${brand.id}`)),
      ).toEqual([]);
    }

    // A catalogue that published everything would make the two halves above
    // indistinguishable.
    expect(below).toBeGreaterThan(0);
  });

  it("gives every advertised brand-by-area page an advertised parent brand page", () => {
    const areaUrls = urls.filter((url) => /\/area\/[^/]+\/drink\/[^/]+$/.test(url));
    expect(areaUrls.length).toBeGreaterThan(0);

    for (const url of areaUrls) {
      const brandSlug = url.slice(url.lastIndexOf("/") + 1);
      expect(urls, `${url} crumbs onto an unpublished /drink/${brandSlug}`).toContain(
        `${SITE}/drink/${brandSlug}`,
      );
    }
  });

  it("advertises no /area/{slug} page, because that family is held", () => {
    // The brand-by-area pages live UNDER /area/{slug}, but the area page itself
    // duplicates /borough/{slug} and is not published. Advertising one would be
    // advertising a 404.
    for (const url of urls.filter((candidate) => candidate.includes("/area/"))) {
      expect(url).toMatch(/\/area\/[^/]+\/drink\/[^/]+$/);
    }
  });

  it("advertises no /out page, because it duplicates /tonight's claim", () => {
    // /out lists the same baseline What's-On rows /tonight already publishes for
    // the same city, so it ships noindex (app/out/page.tsx) until L2 and L4 give
    // it content of its own. A sitemap entry would vouch for the duplicate.
    expect(urls).not.toContain(`${SITE}/out`);
    expect(urls).toContain(`${SITE}/tonight`);
  });

  it("advertises no token / UGC / auth surface", () => {
    for (const url of urls) {
      for (const bad of FORBIDDEN_SUBSTRINGS) {
        expect(url.includes(bad), `${url} must not contain ${bad}`).toBe(false);
      }
    }
  });

  it("emits absolute, query-free canonical URLs only", () => {
    for (const url of urls) {
      expect(url.startsWith(`${SITE}/`)).toBe(true);
      expect(url).not.toContain("?");
      expect(url).not.toContain("#");
    }
  });

  it("has no duplicate URLs", () => {
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("stamps every entry with a plausible lastModified date, never a future or epoch-zero one", () => {
    const now = Date.now();
    for (const entry of entries) {
      expect(entry.lastModified).toBeInstanceOf(Date);
      const time = (entry.lastModified as Date).getTime();
      expect(time).toBeGreaterThan(0);
      expect(time).toBeLessThanOrEqual(now);
    }
  });
});

// A SITEMAP-LISTED ROUTE CARRIES A BUDGET.
//
// The sitemap is the list of pages we ASK a crawler and a stranger to open, and
// perf/route-budgets.json is the only gate that measures what a page costs. A
// family on the first list and off the second is a page that reads as a pass
// and can never fail again: /spoons-value was crawlable, sitemap-listed and
// unbudgeted while serving 683 KB of HTML over 806 server-rendered table rows,
// the heaviest document the site publishes. scripts/check-budget-ratchet.mjs
// already refuses the REMOVAL of a budgeted route on that reasoning; it has no
// rule for a crawlable route that was never added, and this is that rule.
//
// A FAMILY is what is checked, not a URL: the sitemap lists 1,995 /ledger/{id}
// pages and one of them is measured, which is the honest shape of the budget
// (perf/route-budgets.json holds concrete instances, /map/london included).
//
// BUDGET_EXEMPT_FAMILIES is EMPTY, and it may only ever shrink back to empty: a
// row there is a family we advertise and do not measure, and it has to argue
// its own case in one sentence.
const familyOf = (path: string): string => {
  const segments = path.split("/").filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments[0]}`;
};

const BUDGET_EXEMPT_FAMILIES: ReadonlyArray<{ family: string; why: string }> = [
];

describe("every sitemap-listed family carries a performance budget", () => {
  it("names a budgeted route in every family it advertises", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
    vi.resetModules();
    const { default: liveSitemap } = await import("@/app/sitemap");
    const families = new Set(
      (await liveSitemap()).map((entry) => familyOf(new URL(entry.url).pathname)),
    );
    vi.unstubAllEnvs();

    const budgeted = new Set(PERFORMANCE_BUDGETS.routes.map((route) => familyOf(route.path)));
    const exempt = new Set(BUDGET_EXEMPT_FAMILIES.map((row) => row.family));

    const unbudgeted = [...families]
      .filter((family) => !budgeted.has(family) && !exempt.has(family))
      .sort();
    expect(
      unbudgeted,
      "add a measured row to perf/route-budgets.json (docs/PERFORMANCE_BUDGETS.md), or argue the family in BUDGET_EXEMPT_FAMILIES",
    ).toEqual([]);
  });

  it("keeps the exemption list honest: every row is advertised and still unbudgeted", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
    vi.resetModules();
    const { default: liveSitemap } = await import("@/app/sitemap");
    const families = new Set(
      (await liveSitemap()).map((entry) => familyOf(new URL(entry.url).pathname)),
    );
    vi.unstubAllEnvs();
    const budgeted = new Set(PERFORMANCE_BUDGETS.routes.map((route) => familyOf(route.path)));

    const stale = BUDGET_EXEMPT_FAMILIES.filter(
      (row) => !families.has(row.family) || budgeted.has(row.family),
    ).map((row) => row.family);
    expect(
      stale,
      "delete these rows: the family is no longer advertised, or it now carries a budget",
    ).toEqual([]);
  });

  it("measures the crawlable landings the map-deep-link rows live on", () => {
    const paths = new Set(PERFORMANCE_BUDGETS.routes.map((route) => route.path));
    for (const path of [
      "/borough/westminster",
      "/historic/prospect-of-whitby",
      "/landmark/big-ben",
      "/ledger/venue-eltcmh",
      "/spoons-value",
    ]) {
      expect(paths.has(path), `${path} has no row in perf/route-budgets.json`).toBe(true);
    }
  });
});

// D10, the restore path. A month that reaches the admission floor puts the hub
// back with NO code change, so the proof is a fixture snapshot rather than an
// edit to the published file: nothing about this run touches
// public/data/pint_index_snapshot.json.
describe("sitemap Pint Index admission gate", () => {
  const observationsFor = (boroughs: readonly [string, string, number][]) =>
    boroughs.flatMap(([code, name, pubCount]) =>
      Array.from({ length: pubCount }, (_, offset) => ({
        venueId: `${code}-${offset}`,
        pubName: `${name} pub ${offset}`,
        boroughCode: code,
        boroughName: name as PintIndexSnapshot["observations"][number]["boroughName"],
        pricePence: 500 + offset,
        observedAt: "2026-07-10T12:00:00.000Z",
        sourceId: "community-1",
      })),
    );

  async function sitemapWithSnapshot(observations: PintIndexSnapshot["observations"]): Promise<string[]> {
    vi.resetModules();
    const snapshot: PintIndexSnapshot = {
      schemaVersion: 1,
      snapshotId: "admission-floor-fixture",
      status: observations.length === 0 ? "empty" : "published",
      generatedAt: "2026-07-16T00:00:00.000Z",
      observationWindow: observations.length === 0
        ? null
        : { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.999Z" },
      classification: {
        version: "london-borough-point-v1",
        method: "point_in_polygon",
        sourceArtifact: "data/london_boroughs_simplified.json",
        licence: "Open Government Licence v3.0",
      },
      sources: [{
        id: "community-1",
        kind: "confirmed_pint_drop",
        publisher: "PUBMAXX contributor",
        sourceUrl: "https://pubmaxxing.com/evidence/1",
        licence: null,
        confirmationId: "drop-confirmation-1",
        reviewState: "confirmed",
      }],
      observations,
      excluded: [],
    };
    expect(validatePintIndexSnapshot(snapshot)).toMatchObject({ ok: true });
    vi.doMock("@/lib/pintIndexSnapshot.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      loadPublicPintIndexSnapshotOrThrow: async () => snapshot,
    }));
    const { default: gated } = await import("@/app/sitemap");
    const listed = (await gated()).map((entry) => entry.url);
    vi.doUnmock("@/lib/pintIndexSnapshot.server");
    vi.resetModules();
    return listed;
  }

  it("holds the hub while every named borough sits below the floor", async () => {
    const thin = observationsFor([
      ["hackney", "Hackney", SEED_BOROUGH_MONTHLY_TARGET - 1],
      ["westminster", "Westminster", 1],
    ]);
    expect(await sitemapWithSnapshot(thin)).not.toContain(`${SITE}/pint-index`);
  });

  it("holds the hub for an empty month", async () => {
    expect(await sitemapWithSnapshot([])).not.toContain(`${SITE}/pint-index`);
  });

  // Coverage growing may never hide the Index: a thin borough beside a mature
  // one is partial coverage, not a reason to stop advertising the hub.
  it("advertises the hub once one borough reaches the floor, thin rows beside it", async () => {
    const atFloor = observationsFor([
      ["hackney", "Hackney", SEED_BOROUGH_MONTHLY_TARGET],
      ["westminster", "Westminster", 1],
    ]);
    expect(await sitemapWithSnapshot(atFloor)).toContain(`${SITE}/pint-index`);
  });
});

describe("sitemap Social gate", () => {
  it("lists /social when the friends launch flag is on", async () => {
    vi.resetModules();
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
    const { default: sitemapOn } = await import("@/app/sitemap");
    const urlsOn = (await sitemapOn()).map((entry) => entry.url);
    expect(urlsOn).toContain(`${SITE}/social`);
    vi.unstubAllEnvs();
  });
});

// THE SITEMAP IS BUILT ONCE, NOT SERVED PER REQUEST.
//
// This module declares no route-segment config and reads nothing off a request,
// so Next prerenders /sitemap.xml and the CDN hands out that one artifact until
// the next deploy (`next build` marks it Static, and collect-build-traces then
// skips every outputFileTracingIncludes glob for such a route). Two things
// follow, and both are pinned here: an empty pack has to fail the BUILD, and no
// include may be declared for a route that can never receive one.
describe("sitemap() is generated at build, not per request", () => {
  it("rejects a failed Pint Index read instead of publishing a missing hub", async () => {
    vi.resetModules();
    const failure = new Error("Public Pint Index snapshot is unavailable");
    vi.doMock("@/lib/pintIndexSnapshot.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      loadPublicPintIndexSnapshotOrThrow: async () => { throw failure; },
    }));
    try {
      const { default: failedSitemap } = await import("@/app/sitemap");
      await expect(failedSitemap()).rejects.toBe(failure);
    } finally {
      vi.doUnmock("@/lib/pintIndexSnapshot.server");
      vi.resetModules();
    }
  });

  it("declares no route-segment config that would make it dynamic", async () => {
    const route = (await import("@/app/sitemap")) as Record<string, unknown>;

    for (const key of ["dynamic", "revalidate", "fetchCache", "dynamicParams", "runtime"]) {
      expect(route[key]).toBeUndefined();
    }
  });

  // The base contract, restored: loadHistoricPubs() swallows a read error to [],
  // and a generation that silently dropped all 346 /historic/{slug} URLs would
  // be BAKED IN and served to crawlers as those pages having been removed. It
  // must take the build down instead.
  it("refuses to build a sitemap that lost the whole historic family", async () => {
    vi.resetModules();
    vi.doMock("@/lib/historic", () => ({ loadHistoricPubs: async () => [] }));

    const withoutHistoric = (await import("@/app/sitemap")).default;
    await expect(withoutHistoric()).rejects.toThrow(/historic pub dataset is empty/);

    vi.doUnmock("@/lib/historic");
    vi.resetModules();
  });

  // A pin nobody applies is worse than no pin: it reads as a guarantee the
  // deployed function carries the pack, when the route has no function at all.
  // (The key itself may exist - runtimeDataPackIncludes derives one for every
  // reader of a declared pack, sitemap included, and Next drops it for this
  // route the same way. What may not happen is a HAND-WRITTEN pin standing in
  // for the historic pack's ops alarm.) Evaluating the real config the way Next
  // does also proves it still loads.
  it("pins no historic pack onto a route that can never receive one", () => {
    const root = join(__dirname, "..");
    const out = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const m = await import(process.argv[1]);" +
          "console.log(JSON.stringify(m.default.outputFileTracingIncludes ?? null));",
        join(root, "next.config.mjs"),
      ],
      { cwd: root, encoding: "utf8" },
    );
    const includes = JSON.parse(out) as Record<string, string[]>;

    expect(includes["/sitemap.xml"] ?? []).not.toContain(
      "./public/data/historic_pubs.json",
    );
    // The pack still has an ops alarm, and it is the freshness audit over the
    // registry rather than anything in sitemap generation.
    const registered = (
      registry.datasets as Array<{ id: string; artifact: string | null; pack?: boolean }>
    ).find((d) => d.id === "historic_pubs");
    expect(registered?.pack).toBe(true);
    expect(registered?.artifact).toBe("public/data/historic_pubs.json");
  });
});
