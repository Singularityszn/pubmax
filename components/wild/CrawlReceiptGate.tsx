"use client";

// Load the receipt as its own client chunk on every named route page.

import dynamic from "next/dynamic";

import type { WildCrawl } from "@/lib/wildPintLineCrawl";

const CrawlReceipt = dynamic(() => import("./CrawlReceipt"), {
  ssr: false,
  loading: () => <p>Loading the selected pints subtotal.</p>,
});

export default function CrawlReceiptGate({ crawl }: { crawl: WildCrawl }) {
  return <CrawlReceipt crawl={crawl} />;
}
