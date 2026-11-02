"use client";

// The Pint Line's door (lib/wildMode.ts): it renders nothing while the wild
// switch is off, so the line's code and stylesheet are never fetched and the
// page renders exactly as it does without it. On, it loads the line on the
// client alone.

import dynamic from "next/dynamic";

import { useWildMode } from "@/lib/useWildMode";
import type { WildCrawl } from "@/lib/wildPintLineCrawl";

const PintLine = dynamic(() => import("./PintLine"), { ssr: false });

export default function PintLineGate({ crawl }: { crawl: WildCrawl }) {
  return useWildMode() ? <PintLine crawl={crawl} /> : null;
}
