import type { MetadataRoute } from "next";

import { listEnabledCities } from "@/lib/cities";
import { listBoroughs } from "@/lib/boroughs";
import { landmarks } from "@/lib/landmarks";
import { loadHistoricPubs } from "@/lib/historic";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

// Wave S1.2 — dynamic sitemap. Enumerates every token-free, crawlable surface so
// search + AI crawlers discover the whole graph (the map-first UI otherwise hides
// most of it from bots). Scope is provenance-first and honest:
//
//  Included:
//   - static hubs: /, /map, /borough, /historic, /discover, /pubs, /tonight,
//     /choose-city, /crawls, /feed
//   - /map/{city} for every enabled non-London city (London is /map)
//   - /borough/{slug} for every borough present in the price dataset
//   - /landmark/{id} for every curated landmark
//   - /historic/{slug} for every cited historic pub (static, self-canonical SEO
//     pages — the heritage moat)
//   - /ledger/{id} for every venue (the canonical, token-free venue permalink —
//     the price moat; PRD S1.2 "all venue detail permalinks")
//
//  Excluded (by design):
//   - /drinks — 308-redirects to /discover (canonical); a redirecting URL must
//     not be advertised.
//   - anything auth/token/UGC-scoped: /p/, /rounds/, /plan/, /bar-tab/,
//     /messages, /profile, /activity, /auth, /admin, /api/ (see app/robots.ts).
//   - curated crawls: they have NO token-free canonical page URL — they only
//     exist as /map deep-links (curatedCrawlMapHref → /map?mode=build&pubs=…),
//     and user Crawl Stories (/crawls/[slug]) are draft-gated UGC. So no
//     per-crawl sitemap URL exists to include (the /crawls index is listed).
//
// lastModified: derived from the underlying data file's mtime where a page is
// data-driven (prices → pint dataset; historic → historic file), else the build
// date. Honest freshness — never a fabricated "live" timestamp.

const SITE_URL = "https://pubmaxxing.com";

// Read the grouped venue set from the bundled dataset (same read path the
// borough/ledger pages use). Never throws — a failure yields [] so the sitemap
// degrades to the static hubs rather than 500-ing.
async function loadVenues(): Promise<Venue[]> {
  try {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const file = path.join(
      process.cwd(),
      "public",
      "data",
      "pint_prices_app_dataset.json",
    );
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
    return groupVenuePrices(Array.isArray(rows) ? rows : []);
  } catch {
    return [];
  }
}

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
  const [venues, historicPubs, pricesModified, historicModified] =
    await Promise.all([
      loadVenues(),
      loadHistoricPubs(),
      dataFileModified("pint_prices_app_dataset.json", now),
      dataFileModified("historic_pubs.json", now),
    ]);

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
    { path: "/pint-index", priority: 0.8, changeFrequency: "monthly", lastModified: pricesModified },
    { path: "/historic", priority: 0.8, changeFrequency: "weekly", lastModified: historicModified },
    { path: "/discover", priority: 0.7, changeFrequency: "weekly", lastModified: now },
    { path: "/pubs", priority: 0.7, changeFrequency: "weekly", lastModified: pricesModified },
    { path: "/tonight", priority: 0.6, changeFrequency: "daily", lastModified: now },
    { path: "/crawls", priority: 0.6, changeFrequency: "weekly", lastModified: now },
    { path: "/feed", priority: 0.5, changeFrequency: "daily", lastModified: now },
    { path: "/choose-city", priority: 0.5, changeFrequency: "monthly", lastModified: now },
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
