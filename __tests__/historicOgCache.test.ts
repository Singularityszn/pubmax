import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import Image from "@/app/historic/[slug]/opengraph-image";
import { loadHistoricPubs } from "@/lib/historic";
import { OG_CACHE_HEADERS, OG_DEPLOY_STABLE_CACHE_HEADERS } from "@/lib/ogBrand";

// The Historic Pubs plate is drawn only from the committed heritage dataset, so
// it cannot change before the next deploy and the edge may hold it for a year
// (lib/ogBrand.tsx, OG_DEPLOY_STABLE_CACHE_HEADERS). It used to send the hourly
// header every live card sends, so each crawler refetch re-rasterized it.

const SOURCE = readFileSync(
  join(process.cwd(), "app/historic/[slug]/opengraph-image.tsx"),
  "utf8",
);

describe("the historic pub share card's cache", () => {
  it("lets the edge hold the plate for a year and the browser revalidate", () => {
    expect(OG_DEPLOY_STABLE_CACHE_HEADERS["cache-control"]).toBe(
      "public, max-age=0, s-maxage=31536000, stale-while-revalidate=86400",
    );
    // The live cards keep their hour.
    expect(OG_CACHE_HEADERS["cache-control"]).toBe(
      "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    );
  });

  it("sends the year-long header on a rendered plate", async () => {
    const [pub] = await loadHistoricPubs();
    expect(pub, "the committed heritage dataset has a pub").toBeDefined();
    const response = await Image({ params: Promise.resolve({ slug: pub!.slug }) });
    expect(response.headers.get("cache-control")).toBe(
      OG_DEPLOY_STABLE_CACHE_HEADERS["cache-control"],
    );
  });

  it("names the year-long header and no z-index, which Satori ignores", () => {
    expect(SOURCE).toContain("headers: OG_DEPLOY_STABLE_CACHE_HEADERS");
    expect(SOURCE).not.toMatch(/\bOG_CACHE_HEADERS\b/);
    expect(SOURCE).not.toMatch(/zIndex/);
  });
});
