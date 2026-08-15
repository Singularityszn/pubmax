import type { MetadataRoute } from "next";

import { listEnabledCities } from "@/lib/cities";
import { listBoroughs } from "@/lib/boroughs";
import { landmarks } from "@/lib/landmarks";
import { loadHistoricPubs } from "@/lib/historic";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { loadPintIndexArchive, loadPublicPintIndexSnapshot } from "@/lib/pintIndexSnapshot.server";
import { loadNightAreaLandings } from "@/lib/nightAreaLanding.server";
import { loadDrinkBrandLandings } from "@/lib/drinkBrandLanding.server";

// Wave S1.2 dynamic sitemap. Enumerates every token-free, crawlable surface so
// search + AI crawlers discover the whole graph (the map-first UI otherwise hides
// most of it from bots). Scope is provenance-first and honest:
//
//  Included:
//   - static hubs: /, /map, /borough, /historic, /social, /pubs, /tonight,
//     /choose-city, /crawls
//   - /map/{city} for every enabled non-London city (London is /map)
//   - /borough/{slug} for every borough present in the price dataset
//   - /area/{slug} only for governed, crawl-ready areas above the price floor
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
  const [venues, historicPubs, pricesModified, historicModified, pintIndexSnapshot, pintIndexEditions, areaLandings, drinkBrandLandings] =
    await Promise.all([
      loadPintPriceLandingVenues(),
      loadHistoricPubs(),
      dataFileModified("pint_prices_app_dataset.json", now),
      dataFileModified("historic_pubs.json", now),
      loadPublicPintIndexSnapshot(),
      loadPintIndexArchive(),
      loadNightAreaLandings(),
      loadDrinkBrandLandings(),
    ]);
  const pintIndexPublished = pintIndexSnapshot
    ? new Date(pintIndexSnapshot.generatedAt)
    : new Date("2026-07-16T00:00:00.000Z");

  // loadHistoricPubs() swallows read errors to [] (shared lib contract). The
  // historic index is always non-empty in practice (346 cited pubs), so an
  // empty result here means the data source failed — fail loud rather than
  // publish a sitemap missing every /historic/{slug} page.
  if (historicPubs.length === 0) {
    throw new Error(
      "sitemap: historic pub dataset is empty — refusing to publish a truncated sitemap",
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

  // Governed area pages. Eligibility, unique Venue assignment, and the price
  // floor come from the same model the route renders.
  for (const area of areaLandings) {
    entries.push({
      url: `${SITE_URL}/area/${area.slug}`,
      lastModified: pricesModified,
      changeFrequency: "weekly",
      priority: 0.75,
    });
  }

  // Governed drink brand pages. Eligibility and route order come from the
  // same loader used by static params and page rendering.
  for (const landing of drinkBrandLandings) {
    entries.push({
      url: `${SITE_URL}/drink/${landing.slug}`,
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

  // Historic pub detail pages (the cited-heritage moat).
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
