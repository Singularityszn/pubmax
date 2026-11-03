import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({ default: () => () => createElement("div", null, "Crawl view") }));
vi.mock("@/lib/useWildMode", () => ({ useWildMode: () => false }));

import CrawlReceiptGate from "@/components/wild/CrawlReceiptGate";
import PintLineGate from "@/components/wild/PintLineGate";
import type { WildCrawl } from "@/lib/wildPintLineCrawl";

const crawl: WildCrawl = { name: "Soho", plannedStops: 0, stops: [], totalKm: null, totalMinutes: null };

describe("promoted crawl views", () => {
  it("mounts both views when wild mode is off", () => {
    expect(renderToStaticMarkup(createElement(PintLineGate, { crawl }))).toContain("Crawl view");
    expect(renderToStaticMarkup(createElement(CrawlReceiptGate, { crawl }))).toContain("Crawl view");
  });
});
