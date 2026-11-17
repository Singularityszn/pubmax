"use client";

import type { ComponentProps } from "react";
import { MobilePlanActivation } from "./MobilePlanActivation";
import { Button } from "@/components/ui/button";
import { discoveredCuratedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import "./mobilePlanEntry.css";

export function MobilePlanEntry({ crawls, onLoadCrawl, ...props }: ComponentProps<typeof MobilePlanActivation> & {
  crawls: CuratedCrawl[];
  onLoadCrawl: (crawl: CuratedCrawl) => void;
}) {
  const walks = discoveredCuratedCrawls(crawls).filter((crawl) => crawl.walk);
  return <>
    {walks.map((crawl) => <div key={crawl.id} className="mobileWalkEntry">
      <p>{crawl.walk!.kicker}</p>
      <Button variant="secondary" aria-label={`Map ${crawl.name} with ${crawl.walk!.stops.length} stops`} onClick={() => onLoadCrawl(crawl)}><span>{crawl.name}</span><span>{crawl.walk!.stops.length} stops</span></Button>
    </div>)}
    <MobilePlanActivation {...props} />
  </>;
}
