// A DATASET WE COULD NOT READ IS NOT A PUB THAT DOES NOT EXIST.
//
// astra-review P1-2. `/bar-tab/[id]` and `/ledger/[id]` each parse
// `public/data/pint_prices_app_dataset.json` once per process. When that read
// threw, the catch left the index empty AND memoised it, so every Bar Tab and
// Ledger URL answered "This pub isn't on the tab" until the instance recycled.
// `app/AGENTS.md` already forbids collapsing a failed venue-detail read into an
// unknown pub on `/api/venue/[id]`; these two pages never joined that rule.
//
// Held here as behaviour: a throwing `fs.readFile` renders the unavailable
// surface, the next request reads the file again, and only a successful parse
// is ever cached.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

const dataset = vi.hoisted(() => ({
  fail: false,
  reads: 0,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const readFile = actual.promises.readFile;
  const promises = {
    ...actual.promises,
    readFile: async (file: unknown, ...rest: unknown[]) => {
      if (typeof file === "string" && file.endsWith("pint_prices_app_dataset.json")) {
        dataset.reads += 1;
        if (dataset.fail) throw new Error("EIO: i/o error, read");
      }
      return (readFile as (...args: unknown[]) => Promise<unknown>)(file, ...rest);
    },
  };
  return { ...actual, promises, default: { ...actual, promises } };
});

import BarTabPage, { generateMetadata as barTabMetadata } from "@/app/bar-tab/[id]/page";
import LedgerPage, { generateMetadata as ledgerMetadata } from "@/app/ledger/[id]/page";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

const rows = JSON.parse(read("public/data/pint_prices_app_dataset.json")) as VenuePrice[];
const venue = groupVenuePrices(rows)[0];

async function render(page: (props: { params: Promise<{ id: string }> }) => Promise<unknown>, id: string) {
  const element = await page({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(createElement(() => element as React.ReactElement));
}

beforeEach(() => {
  dataset.fail = false;
  dataset.reads = 0;
});

describe.each([
  {
    surface: "the Bar Tab",
    page: BarTabPage,
    metadata: barTabMetadata,
    href: `/bar-tab/${encodeURIComponent(venue.id)}`,
    notFoundLine: "on the tab",
  },
  {
    surface: "the Ledger",
    page: LedgerPage,
    metadata: ledgerMetadata,
    href: `/ledger/${encodeURIComponent(venue.id)}`,
    notFoundLine: "in the ledger",
  },
])("$surface over a dataset read that threw", ({ page, metadata, href, notFoundLine }) => {
  it("answers unavailable, reads again on the next request, and caches only a successful parse", async () => {
    // 1. The read throws: the unavailable surface, never the not-found document.
    dataset.fail = true;
    const markup = await render(page, venue.id);
    expect(markup).toContain("We could not load this pub");
    expect(markup).toContain("could not answer just now");
    expect(markup).toContain(`href="${href}"`);
    expect(markup).toContain("Try again");
    expect(markup).not.toContain(notFoundLine);
    expect(markup).not.toContain("moved");
    // docs/VOICE.md: never a closed door.
    expect(markup).not.toMatch(/check back later|try again later|please try again/i);
    expect(dataset.reads).toBe(1);

    // The unfurl claims nothing either way.
    const failed = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(JSON.stringify(failed)).not.toContain(venue.name);
    expect(failed.robots).toEqual({ index: false, follow: false });
    expect(dataset.reads).toBe(2);

    // 2. The file is readable again: the next request reads it and finds the pub.
    dataset.fail = false;
    const found = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(String(found.title)).toContain(venue.name);
    expect(dataset.reads).toBe(3);

    // 3. Only that successful parse is cached: a later failure changes nothing
    //    and the file is not opened again.
    dataset.fail = true;
    const held = await metadata({ params: Promise.resolve({ id: venue.id }) });
    expect(String(held.title)).toContain(venue.name);
    expect(dataset.reads).toBe(3);
  });
});

describe("the source keeps the rule", () => {
  const pages = ["app/bar-tab/[id]/page.tsx", "app/ledger/[id]/page.tsx"];

  it("never memoises the index on the failure path", () => {
    for (const file of pages) {
      const source = read(file);
      const failure = source.slice(source.indexOf("} catch {"));
      const catchBody = failure.slice(0, failure.indexOf("\n    }"));
      expect(catchBody, file).not.toContain("cachedVenues =");
      expect(source, file).toContain('return { status: "unavailable" };');
    }
  });

  it("carries no em dash, in copy or in a comment", () => {
    // The em-dash law scans strings in components/; the captain's law is global,
    // and these two files carried one each in the comment this PR rewrote.
    for (const file of pages) {
      expect(read(file), file).not.toContain("—");
    }
  });
});
