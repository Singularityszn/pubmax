"use client";

import Link from "next/link";
import RouteThumbnail from "@/app/crawls/RouteThumbnail";
import { curatedCrawlMapHref, type CuratedCrawl } from "@/lib/curatedCrawls";
import { curatedWalkKm, type CuratedWalk } from "@/lib/curatedWalk";
import "@/components/map/route/curatedWalk.css";

export default function CuratedWalkCard({ crawl, walk }: { crawl: CuratedCrawl; walk: CuratedWalk }) {
  const coords = walk.stops.map((stop): [number, number] => [stop.longitude, stop.latitude]);
  return (
    <div className="curatedFeaturedWrap">
        <p className="crawlEyebrow curatedFeaturedEyebrow">{walk.kicker}</p>
      <article id={crawl.id} className="curatedCard curatedFeaturedCard">
        <h2 className="curatedName">{crawl.name}</h2>
        <p className="curatedBlurb">{crawl.blurb}</p>
        <p className="curatedMeta">{walk.stops.length} stops · approx. {curatedWalkKm(walk).toFixed(1)} km</p>
        <Link className="curatedPlanBtn" href={curatedCrawlMapHref(crawl)} prefetch={false}>{walk.mapActionLabel}</Link>
        <RouteThumbnail className="curatedWalkPreview" points={coords} linePoints={walk.path} numberSize="compact" stopNumbers={coords.map((_, index) => index + 1)} label={`${crawl.name}, ${walk.stops.length} numbered stops`} />
        <p className="curatedMeta curatedWalkCredit">Walking line © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a></p>
      </article>
    </div>
  );
}
