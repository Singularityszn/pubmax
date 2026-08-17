import type { MetadataRoute } from "next";

import { listEnabledCities } from "@/lib/cities";
import { listBoroughs } from "@/lib/boroughs";
import { landmarks } from "@/lib/landmarks";
import { loadHistoricPubs } from "@/lib/historic";
import { loadPintPriceLandingVenuesOrThrow } from "@/lib/pintPriceLandingDataset.server";
import { loadPintIndexArchive, loadPublicPintIndexSnapshot } from "@/lib/pintIndexSnapshot.server";
import { loadDrinkBrandLandings } from "@/lib/drinkBrandLanding.server";
import {
  drinkBrandAreaLandingRoute,
  loadDrinkBrandAreaLandings,
} from "@/lib/drinkBrandAreaLanding.server";

// Wave S1.2 dynamic sitemap. Enumerates every token-free, crawlable surface so
// search + AI crawlers discover the whole graph (the map-first UI otherwise hides
// most of it from bots). Scope is provenance-first and honest:
//
//  Included:
//   - static hubs: /, /map, /borough, /historic, /social, /pubs, /tonight,
//     /choose-city, /crawls
//   - /map/{city} for every enabled non-London city (London is /map)
//   - /borough/{slug} for every borough present in the price dataset
//   - /drink/{slug} and /area/{slug}/drink/{brand} for every governed drink
//     landing above its publication floor (the same loaders the routes render)
//   - /landmark/{id} for every curated landmark
//   - /historic/{slug} for every cited historic pub (static, self-canonical SEO
//     pages, the heritage moat)
//   - /ledger/{id} for every venue (the canonical, token-free venue permalink,
//     the price moat; PRD S1.2 "all venue detail permalinks")
//
//  Excluded (by design):
//   - /feed, /stories, /discover and /drinks redirect to Social; redirecting
//     URLs must not be advertised.
//   - anything auth/token/UGC-scoped: /p/, /rounds/, /plan/, /bar-tab/,
//     /messages, /profile, /activity, /auth, /admin, /api/ (see app/robots.ts).
//   - curated crawls: they have no token-free canonical page URL. They only
//     exist as /map deep-links (curatedCrawlMapHref to /map?mode=build&pubs=…),
//     and user Crawl Stories (/crawls/[slug]) are draft-gated UGC. So no
//     per-crawl sitemap URL exists to include (the /crawls index is listed).
//
// lastModified: legacy map/borough and historic pages retain their underlying
// artifact mtimes. The citable Pint Index uses its validated snapshot's
// generatedAt; that value describes publication, never when a price was seen.
// Other static routes use the build date.

const SITE_URL = "https://pubmaxxing.com";

// The grouped venue set comes from the shared per-instance index (the read path
// every priced surface uses). The sitemap's own wrapper FAILS LOUD: a
// read/parse/grouping failure - or an unexpectedly empty dataset - throws,
// aborting sitemap generation. This is intentional (CodeRabbit S1 review): that
// dataset derives the ledger, borough, venue and drink families, so publishing
// a 200 without it would be a near-empty sitemap over the whole core graph. A
// thrown error surfaces as a 500 for /sitemap.xml instead, so no truncated
// generation is served at all. The rule governs THAT lane only: the historic
// pack below is optional and degrades to a logged omission.

// mtime of a public/data file as a Date, or `fallback` when it can't be read.
async function dataFileModified(name: string, fallback: Date): Promise<Date> {
  try {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const stat = await fs.stat(path.join(process.cwd(), "public", "data", name));
    return stat.mtime;
  } catch {
    return fallback;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [
    venues,
    historicPubs,
    pricesModified,
    historicModified,
    pintIndexSnapshot,
    pintIndexEditions,
    drinkBrandLandings,
    drinkBrandAreaLandings,
  ] = await Promise.all([
    loadPintPriceLandingVenuesOrThrow(),
    loadHistoricPubs(),
    dataFileModified("pint_prices_app_dataset.json", now),
    dataFileModified("historic_pubs.json", now),
    loadPublicPintIndexSnapshot(),
    loadPintIndexArchive(),
    loadDrinkBrandLandings(),
    loadDrinkBrandAreaLandings(),
  ]);
  const pintIndexPublished = pintIndexSnapshot
    ? new Date(pintIndexSnapshot.generatedAt)
    : new Date("2026-07-16T00:00:00.000Z");

  // Historic URLs are optional for sitemap generation: a failed or empty read
  // omits /historic/{slug} only, while the core price-derived families still
  // publish. Ops get a loud `[sitemap][ALERT]` line (freshness-audit idiom) so
  // an empty historic pack is not mistaken for health.
  if (historicPubs.length === 0) {
    console.error(
      "[sitemap][ALERT] historic pub dataset is empty or unreadable; /historic/{slug} URLs are omitted from this generation and price-derived URLs still ship",
    );
  }

  const entries: MetadataRoute.Sitemap = [];

  // Static hubs.
  const staticRoutes: {
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
    lastModified: Date;
  }[] = [
    { path: "/", priority: 1.0, changeFrequency: "daily", lastModified: now },
    { path: "/map", priority: 0.9, changeFrequency: "weekly", lastModified: pricesModified },
    { path: "/borough", priority: 0.8, changeFrequency: "weekly", lastModified: pricesModified },
    { path: "/pint-index", priority: 0.8, changeFrequency: "monthly", lastModified: pintIndexPublished },
    { path: "/historic", priority: 0.8, changeFrequency: "weekly", lastModified: historicModified },
    { path: "/social", priority: 0.7, changeFrequency: "daily", lastModified: now },
    { path: "/pubs", priority: 0.7, changeFrequency: "weekly", lastModified: pricesModified },
    { path: "/tonight", priority: 0.6, changeFrequency: "daily", lastModified: now },
    { path: "/crawls", priority: 0.6, changeFrequency: "weekly", lastModified: now },
    { path: "/choose-city", priority: 0.5, changeFrequency: "monthly", lastModified: now },
    { path: "/about", priority: 0.5, changeFrequency: "monthly", lastModified: now },
    { path: "/founders", priority: 0.4, changeFrequency: "weekly", lastModified: now },
    // Static, token-free content pages a reader (or a crawler checking the site
    // is legitimate) must be able to find: they are linked from the footer and
    // carry no UGC, so they belong in the sitemap like /about.
    { path: "/privacy", priority: 0.3, changeFrequency: "yearly", lastModified: now },
    { path: "/terms", priority: 0.3, changeFrequency: "yearly", lastModified: now },
  ];
  for (const r of staticRoutes) {
    entries.push({
      url: `${SITE_URL}${r.path}`,
      lastModified: r.lastModified,
      changeFrequency: r.changeFrequency,
      priority: r.priority,
    });
  }

  // City maps: /map is London; every other enabled city is /map/{id}.
  for (const city of listEnabledCities()) {
    if (city.id === "london") continue; // already covered by /map
    entries.push({
      url: `${SITE_URL}/map/${city.id}`,
      lastModified: pricesModified,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  // Borough pages — one per borough present in the dataset.
  for (const borough of listBoroughs(venues)) {
    entries.push({
      url: `${SITE_URL}/borough/${borough.slug}`,
      lastModified: pricesModified,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  // Governed drink brand pages. Eligibility and route order come from the same
  // loader the route and generateStaticParams use, so the three cannot disagree
  // about which pages exist.
  for (const landing of drinkBrandLandings) {
    entries.push({
      url: `${SITE_URL}/drink/${encodeURIComponent(landing.slug)}`,
      lastModified: pricesModified,
      changeFrequency: "weekly",
      priority: 0.75,
    });
  }

  // Governed brand-by-area pages. Same rule, same loader. The parent
  // /area/{slug} family is HELD (it duplicates /borough/{slug}), so no area
  // page is published or advertised here.
  for (const landing of drinkBrandAreaLandings) {
    entries.push({
      url: `${SITE_URL}${drinkBrandAreaLandingRoute(landing)}`,
      lastModified: pricesModified,
      changeFrequency: "weekly",
      priority: 0.75,
    });
  }

  // Dated Pint Index editions. Frozen by contract, so they never change again
  // once published: "yearly" is the honest change frequency, not a hedge.
  for (const edition of pintIndexEditions) {
    entries.push({
      url: `${SITE_URL}/pint-index/${edition.archive.month}`,
      lastModified: new Date(edition.archive.publishedAt),
      changeFrequency: "yearly",
      priority: 0.6,
    });
  }

  // Landmark story chapters.
  for (const landmark of landmarks) {
    entries.push({
      url: `${SITE_URL}/landmark/${landmark.id}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    });
  }

  // Historic pub detail pages (the cited-heritage moat). Omitted when the
  // dataset read failed — see alert above; never pretend the section is complete.
  for (const pub of historicPubs) {
    entries.push({
      url: `${SITE_URL}/historic/${pub.slug}`,
      lastModified: historicModified,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  // Venue permalinks — the canonical, token-free per-pub page (price moat).
  for (const venue of venues) {
    entries.push({
      url: `${SITE_URL}/ledger/${venue.id}`,
      lastModified: pricesModified,
      changeFrequency: "weekly",
      priority: 0.5,
    });
  }

  return entries;
}
