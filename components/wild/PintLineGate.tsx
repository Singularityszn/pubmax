"use client";

// Load the Pint Line as its own client chunk on every named route page.

import dynamic from "next/dynamic";

import type { WildCrawl } from "@/lib/wildPintLineCrawl";

const PintLine = dynamic(() => import("./PintLine"), {
  ssr: false,
  loading: () => <p>Loading the route diagram. The stops are listed below.</p>,
});

export default function PintLineGate({ crawl }: { crawl: WildCrawl }) {
  return <PintLine crawl={crawl} />;
}
