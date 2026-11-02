"use client";

// The crawl receipt's door (lib/wildMode.ts): it renders nothing while the
// wild switch is off, so the receipt's code and stylesheet are never fetched
// and the page renders exactly as it does without it. On, it loads the
// receipt on the client alone.

import dynamic from "next/dynamic";

import { useWildMode } from "@/lib/useWildMode";
import type { WildCrawl } from "@/lib/wildPintLineCrawl";

const CrawlReceipt = dynamic(() => import("./CrawlReceipt"), { ssr: false });

export default function CrawlReceiptGate({ crawl }: { crawl: WildCrawl }) {
  return useWildMode() ? <CrawlReceipt crawl={crawl} /> : null;
}
