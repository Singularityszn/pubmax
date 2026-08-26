import type { AltCrawlStyle } from "@/lib/crawlUrl";

const EAGER_CRAWL_HINTS: Readonly<Record<string, AltCrawlStyle>> = {
  "leicester-mocktail-crawl": "mocktail",
};

export function eagerCuratedCrawlAltStyle(crawlId: string): AltCrawlStyle | undefined {
  return Object.prototype.hasOwnProperty.call(EAGER_CRAWL_HINTS, crawlId)
    ? EAGER_CRAWL_HINTS[crawlId]
    : undefined;
}
