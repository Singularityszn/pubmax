import { curatedCrawls } from "@/lib/curatedCrawls";

// Named route packs — thematic groupings of curated crawls for the /crawls
// page. Packs may share crawl ids; membership is by curated crawl `id` only
// (never invents venues). Packs that cannot be fully filled from today's
// curated set still ship with the best available crawlIds so the UI stays
// honest rather than fabricating routes.

export type RoutePack = {
  id: string;
  title: string;
  blurb: string;
  /** Curated crawl ids from lib/curatedCrawls — may overlap across packs. */
  crawlIds: string[];
};

const CURATED_IDS = new Set(curatedCrawls.map((c) => c.id));

function pack(
  id: string,
  title: string,
  blurb: string,
  crawlIds: string[],
): RoutePack {
  // Drop unknown ids so a renamed curated crawl never 404s a pack link.
  return { id, title, blurb, crawlIds: crawlIds.filter((cid) => CURATED_IDS.has(cid)) };
}

export const routePacks: RoutePack[] = [
  pack(
    "thames",
    "Thames",
    "River walks and waterside taverns — Bankside to Limehouse along the tide.",
    ["riverside-heritage", "bankside-riverside"],
  ),
  pack(
    "writers",
    "Writers",
    "Press-strip snugs and Bloomsbury reading-room rounds for the literary crawl.",
    ["fleet-street-writers", "bloomsbury-literary"],
  ),
  pack(
    "cheap-chaos",
    "Cheap chaos",
    "Market loops and high-street energy when the night should stay loud and affordable.",
    ["borough-market-crawl", "camden-market-crawl", "victorian-soho"],
  ),
  pack(
    "late-train",
    "Late train",
    "Tight central clusters near major stations — finish the round and still catch the last one.",
    ["victorian-soho", "leicester-mocktail-crawl", "soho-food-crawl"],
  ),
  pack(
    "quiet-table",
    "Quiet table",
    "Softer nights: food-first Soho plates, a soft round, and a skyline garden climb.",
    ["soho-food-crawl", "leicester-mocktail-crawl", "pint-park-view"],
  ),
];

/** Look up a pack by id, or undefined when unknown. */
export function getRoutePack(id: string): RoutePack | undefined {
  return routePacks.find((p) => p.id === id);
}

/** Every curated crawl id that appears in at least one pack. */
export function allPackCrawlIds(): string[] {
  return [...new Set(routePacks.flatMap((p) => p.crawlIds))];
}
