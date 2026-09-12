import "server-only";

import type { EditorialCardData } from "@/components/discovery/EditorialCard";
import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { cityAwareMapPath } from "@/lib/cityMapHref";
import { curatedCrawlById, curatedCrawlMapHref, type CuratedCrawl } from "@/lib/curatedCrawls";
import { getRoutePack, routePackPrimaryCrawl } from "@/lib/routePacks";

/** Map-first crawl href, or city map if the curated id is missing. */
function crawlMapHref(crawlId: string, cityId: CityId): string {
  const crawl = curatedCrawlById(crawlId);
  return crawl
    ? curatedCrawlMapHref(crawl, cityId)
    : cityAwareMapPath(cityId);
}

/** Map-first pack lead crawl, or city map if the pack is empty. */
function packMapHref(packId: string, cityId: CityId): string {
  const pack = getRoutePack(packId);
  if (!pack) return cityAwareMapPath(cityId);
  const primary = routePackPrimaryCrawl(pack);
  return primary
    ? curatedCrawlMapHref(primary, cityId)
    : cityAwareMapPath(cityId);
}

// These editorial routes use the explicit London default, regardless of the preferred city.
export function buildDiscoverEditorial(): EditorialCardData[] {
  return [
    {
      id: "golden-days",
      eyebrow: "Golden days",
      title: "The old guard, still standing",
      dek: "Victorian gin palaces, listed snugs, and the bar Dickens leaned on.",
      href: crawlMapHref("victorian-soho", DEFAULT_CITY_ID),
      cta: "Walk Victorian Soho",
    },
    {
      id: "coding-pint",
      eyebrow: "Coding pint",
      title: "A quiet table and a slow pint",
      dek: "Pubs with sockets, listed Wi-Fi and quieter afternoon notes.",
      href: crawlMapHref("barbican-coding-pint", DEFAULT_CITY_ID),
      cta: "Find a working pint",
    },
    {
      id: "then-vs-now",
      eyebrow: "Then vs now",
      title: "What a pint used to cost",
      dek: "Listed pints around £4, mapped into a walk.",
      href: packMapHref("cheap-chaos", DEFAULT_CITY_ID),
      cta: "Build a cheap crawl",
    },
    {
      id: "tonights-crawl",
      eyebrow: "Tonight",
      title: "Tonight's crawl, sorted",
      dek: "Pick a borough and set your price before opening the route on the map.",
      href: packMapHref("late-train", DEFAULT_CITY_ID),
      cta: "Plan an outing",
    },
  ];
}

// Heritage cards retain the shared crawl-link format and the explicit London default.
const HERITAGE_CTA_LABELS: Readonly<Record<string, string>> = {
  "heritage-oldest-pubs": "Start with the oldest",
  "heritage-riverside-taverns": "Walk the Thames taverns",
  "heritage-grade-listed": "See the listed classics",
};

export function buildDiscoverHeritageCards(crawls: CuratedCrawl[]): EditorialCardData[] {
  return crawls.map((crawl) => ({
    id: `heritage-${crawl.id}`,
    eyebrow: "Historic London",
    title: crawl.name,
    dek: crawl.blurb,
    href: curatedCrawlMapHref(crawl, DEFAULT_CITY_ID),
    cta: HERITAGE_CTA_LABELS[crawl.id] ?? "Open this heritage route",
  }));
}

