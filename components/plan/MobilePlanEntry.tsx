"use client";

import type { ComponentProps } from "react";
import { MobilePlanActivation } from "./MobilePlanActivation";
import { Button } from "@/components/ui/button";
import { discoveredCuratedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";

export function MobilePlanEntry({ crawls, onLoadCrawl, ...props }: ComponentProps<typeof MobilePlanActivation> & {
  crawls: CuratedCrawl[];
  onLoadCrawl: (crawl: CuratedCrawl) => void;
}) {
  const walks = discoveredCuratedCrawls(crawls).filter((crawl) => crawl.walk);
  return <>
    {walks.map((crawl) => <Button key={crawl.id} variant="secondary" aria-label={`Map ${crawl.name} with ${crawl.walk!.stops.length} stops`} onClick={() => onLoadCrawl(crawl)}>{crawl.name} · {crawl.walk!.stops.length} stops</Button>)}
    <MobilePlanActivation {...props} />
  </>;
}
