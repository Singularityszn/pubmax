// Astra's live walk (7 Sep 2026, finding B7). Two things about the 404, both
// invisible until you open a console or read the browser tab.
//
// It emitted 18 console warnings, 17 of them "preloaded using link preload but
// not used", the noisiest console on the site by a factor of six. They were
// not the page's own stylesheets. Next prefetches a Link on sight, and this
// page's two doors are /map and /tonight, the heaviest routes on the site, so
// it pulled in one CSS chunk per segment of both and used none of them.
//
// And with no metadata of its own it inherited the root layout's default
// title, so a dead link and the landing page were the same browser tab.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { metadata } from "@/app/not-found";

const SOURCE = readFileSync(join(process.cwd(), "app/not-found.tsx"), "utf8");

describe("the 404 document", () => {
  it("names itself, rather than answering to the homepage's title", () => {
    expect(metadata.title).toBe("Page not found");
  });

  it("is not indexable, and still points a crawler onward", () => {
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("prefetches neither of its two doors", () => {
    // The rule itself lives in __tests__/linkPrefetchFence.test.ts, which reads
    // every Link in the tree. This is the count: two doors, two guards.
    expect(SOURCE.match(/prefetch=\{false\}/g)).toHaveLength(2);
    expect(SOURCE.match(/<Link\b/g)).toHaveLength(2);
  });

  it("still offers the two ways out", () => {
    expect(SOURCE).toContain('href="/map"');
    expect(SOURCE).toContain('href="/tonight"');
  });
});
