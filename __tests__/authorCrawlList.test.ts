import { describe, expect, it } from "vitest";

import {
  AUTHOR_CRAWL_LIST_DEFAULT_LIMIT,
  AUTHOR_CRAWL_LIST_MAX_LIMIT,
  clampAuthorCrawlListLimit,
  ownUnlistedCrawlsLabel,
} from "@/lib/authorCrawlList";

// The two page bounds and the one line that explains an owner's private crawls.
// Kept in an import-free leaf so the browser can read them without pulling the
// server-only crawl-story store in behind them.

describe("clampAuthorCrawlListLimit", () => {
  it("keeps a limit inside the published range", () => {
    expect(clampAuthorCrawlListLimit(1)).toBe(1);
    expect(clampAuthorCrawlListLimit(AUTHOR_CRAWL_LIST_MAX_LIMIT)).toBe(
      AUTHOR_CRAWL_LIST_MAX_LIMIT,
    );
  });

  it("clamps past either end rather than refusing a read", () => {
    expect(clampAuthorCrawlListLimit(0)).toBe(1);
    expect(clampAuthorCrawlListLimit(-4)).toBe(1);
    expect(clampAuthorCrawlListLimit(500)).toBe(AUTHOR_CRAWL_LIST_MAX_LIMIT);
  });

  it("shows the ordinary first page for anything unparseable", () => {
    for (const junk of ["nope", "", null, undefined, Number.NaN]) {
      expect(clampAuthorCrawlListLimit(junk)).toBe(AUTHOR_CRAWL_LIST_DEFAULT_LIMIT);
    }
  });

  it("reads a numeric string the way a query param arrives", () => {
    expect(clampAuthorCrawlListLimit("3")).toBe(3);
    expect(clampAuthorCrawlListLimit("3.9")).toBe(3);
  });
});

// This line is the whole reason the owner's extra crawls are not a bare second
// number: it names them, says who can see them, and heads the rows themselves.
describe("ownUnlistedCrawlsLabel", () => {
  it("agrees with itself about one", () => {
    const line = ownUnlistedCrawlsLabel(1);
    expect(line).toContain("1 unlisted crawl ");
    expect(line).not.toContain("crawls");
    expect(line).toContain("only you see this");
  });

  it("names the count and the audience for several", () => {
    const line = ownUnlistedCrawlsLabel(4);
    expect(line).toContain("4 unlisted crawls");
    expect(line).toContain("only you see these");
  });

  it("never carries a dash the voice law bans", () => {
    for (const total of [1, 2, 12]) {
      expect(ownUnlistedCrawlsLabel(total)).not.toMatch(/[–—]/);
    }
  });
});
