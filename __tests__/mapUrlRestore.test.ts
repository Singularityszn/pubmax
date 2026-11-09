import { describe, expect, it } from "vitest";

import { crawlUrlWriteAllowed, mergeCrawlUrlSearch } from "@/components/map/useCrawlUrl";
import { initialFilters } from "@/components/map/ControlRail";
import { encodeCrawl, type CrawlUrlState } from "@/lib/crawlUrl";

// An address the reader typed wins over stored state.
//
// A saved session put a previous visit's search back on the map, and the URL
// sync then wrote it out: a typed `/map` became `/map?q=Camden`, so a clean
// shared link mutated into somebody's stale search. Restoring the map is fine.
// Rewriting a clean address is not.

function state(overrides: Partial<CrawlUrlState["filters"]> = {}): CrawlUrlState {
  return {
    mode: "suggest",
    filters: { ...initialFilters, query: "Camden", ...overrides },
    builtIds: [],
    selectedVenueId: "",
  };
}

describe("Clean-URL hold — what a restored session may write", () => {
  const restored = encodeCrawl(state());
  const hold = { encodedAtMount: restored };

  it("keeps a table ask until the selected sheet consumes it", () => {
    expect(mergeCrawlUrlSearch("sel=pub", "?sel=pub&table=8")).toBe("sel=pub&table=8");
    expect(mergeCrawlUrlSearch("sel=pub", "?sel=pub")).toBe("sel=pub");
  });

  it("never copies a table ask onto another pub or a selection-free address", () => {
    expect(mergeCrawlUrlSearch("sel=pub-b", "?sel=pub-a&table=8")).toBe("sel=pub-b");
    expect(mergeCrawlUrlSearch("", "?table=8")).toBe("");
    expect(mergeCrawlUrlSearch("sel=pub-b", "?table=8")).toBe("sel=pub-b");
  });

  it("has something to write, which is the whole defect", () => {
    expect(restored).toBe("q=Camden");
  });

  it("writes nothing while the map still holds only what was restored", () => {
    expect(crawlUrlWriteAllowed(hold, restored)).toBe(false);
  });

  it("writes again as soon as the reader changes something", () => {
    const changed = encodeCrawl(state({ query: "Brixton" }));
    expect(crawlUrlWriteAllowed(hold, changed)).toBe(true);
    // A change that is not the search releases it too, and carries the
    // restored search out with it, because the map really is filtered by it.
    const priced = encodeCrawl(state({ maxPrice: 6 }));
    expect(crawlUrlWriteAllowed(hold, priced)).toBe(true);
    expect(priced).toContain("q=Camden");
  });

  it("never holds an arrival that carried its own address", () => {
    // No hold: the reader's URL and the map already agree, so every state
    // change writes as before.
    expect(crawlUrlWriteAllowed(null, restored)).toBe(true);
    expect(crawlUrlWriteAllowed(null, "")).toBe(true);
  });

  it("keeps a pending curated crawl id in the address", () => {
    expect(mergeCrawlUrlSearch("", "?crawl=leicester-mocktail-crawl", true)).toBe(
      "crawl=leicester-mocktail-crawl",
    );
  });
});
