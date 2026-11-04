"use client";

// Load the receipt as its own client chunk on every named route page.

import dynamic from "next/dynamic";

import type { WildCrawl } from "@/lib/wildPintLineCrawl";
import CrawlPresentationBoundary from "./CrawlPresentationBoundary";

const CrawlReceipt = dynamic(() => import("./CrawlReceipt"), {
  ssr: false,
  loading: () => <p>Loading the selected pints subtotal.</p>,
});

export default function CrawlReceiptGate({ crawl }: { crawl: WildCrawl }) {
  return <CrawlPresentationBoundary key={crawl.name} fallback={
    <p role="status">The selected pints subtotal could not load. The stops still show each listed price.</p>
  }><CrawlReceipt crawl={crawl} /></CrawlPresentationBoundary>;
}
