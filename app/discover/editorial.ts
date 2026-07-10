import type { EditorialCardData } from "@/components/discovery/EditorialCard";
import { curatedCrawlById, curatedCrawlMapHref } from "@/lib/curatedCrawls";
import { getRoutePack, routePackMapHref } from "@/lib/routePacks";

/** Map-first crawl href, or /map if the curated id is missing. */
function crawlMapHref(crawlId: string): string {
  const crawl = curatedCrawlById(crawlId);
  return crawl ? curatedCrawlMapHref(crawl) : "/map";
}

/** Map-first pack lead crawl, or /map if the pack is empty. */
function packMapHref(packId: string): string {
  const pack = getRoutePack(packId);
  return pack ? routePackMapHref(pack) : "/map";
}

// Static editorial lanes. Each CTA opens /map with a real crawl polyline
// (curatedCrawlMapHref / routePackMapHref) — not a bare filter or list page.
export const DISCOVER_EDITORIAL: EditorialCardData[] = [
  {
    id: "golden-days",
    eyebrow: "Golden days",
    title: "The old guard, still standing",
    dek: "Victorian gin palaces, listed snugs, and the bar Dickens actually leaned on — a walk through the London that refuses to close.",
    href: crawlMapHref("victorian-soho"),
    cta: "Walk the heritage route",
  },
  {
    id: "coding-pint",
    eyebrow: "Coding pint",
    title: "A quiet table and a slow pint",
    dek: "Sockets, decent Wi-Fi, and a late-afternoon lull — the pubs that double as the best co-working room in the city.",
    href: crawlMapHref("barbican-coding-pint"),
    cta: "Find a working pint",
  },
  {
    id: "then-vs-now",
    eyebrow: "Then vs now",
    title: "What a pint used to cost",
    dek: "The cheapest taps in town, ranked. Proof the good £4 pint isn't extinct — you just have to know where to walk.",
    href: packMapHref("cheap-chaos"),
    cta: "Build a cheap crawl",
  },
  {
    id: "tonights-crawl",
    eyebrow: "Tonight",
    title: "Tonight's crawl, sorted",
    dek: "Pick a borough, set your price, and let the river do the routing. Every pin is a pint worth knowing about.",
    href: packMapHref("late-train"),
    cta: "Plan tonight",
  },
];
