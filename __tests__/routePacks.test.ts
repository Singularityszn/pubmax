import { describe, expect, it } from "vitest";

import { curatedCrawls } from "@/lib/curatedCrawls";
import { allPackCrawlIds, getRoutePack, routePacks } from "@/lib/routePacks";

const curatedIds = new Set(curatedCrawls.map((c) => c.id));

describe("routePacks", () => {
  it("ships the five named packs", () => {
    expect(routePacks.map((p) => p.id).sort()).toEqual(
      ["cheap-chaos", "late-train", "quiet-table", "thames", "writers"].sort(),
    );
  });

  it("only references real curated crawl ids", () => {
    for (const pack of routePacks) {
      expect(pack.crawlIds.length).toBeGreaterThan(0);
      for (const id of pack.crawlIds) {
        expect(curatedIds.has(id)).toBe(true);
      }
    }
  });

  it("maps Thames / writers membership to the expected crawls", () => {
    expect(getRoutePack("thames")?.crawlIds).toEqual(
      expect.arrayContaining(["riverside-heritage", "bankside-riverside"]),
    );
    expect(getRoutePack("writers")?.crawlIds).toEqual(
      expect.arrayContaining(["fleet-street-writers", "bloomsbury-literary"]),
    );
  });

  it("exposes a deduped union of pack crawl ids", () => {
    const ids = allPackCrawlIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(5);
  });
});
