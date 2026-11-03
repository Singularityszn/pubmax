"use client";

// Load the Pint Line as its own client chunk on every named route page.

import dynamic from "next/dynamic";

import type { WildCrawl } from "@/lib/wildPintLineCrawl";
import CrawlPresentationBoundary from "./CrawlPresentationBoundary";

const PintLine = dynamic(() => import("./PintLine"), {
  ssr: false,
  loading: () => <p>Loading the route diagram. The stops are listed below.</p>,
});

export default function PintLineGate({ crawl }: { crawl: WildCrawl }) {
  return <CrawlPresentationBoundary key={crawl.name} fallback={
    <p role="status">The route diagram could not load. The stops and map link are still available.</p>
  }><PintLine crawl={crawl} /></CrawlPresentationBoundary>;
}
