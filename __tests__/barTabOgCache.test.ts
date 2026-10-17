import { describe, expect, it } from "vitest";

import Image from "@/app/bar-tab/[id]/opengraph-image";
import { OG_CACHE_HEADERS } from "@/lib/ogBrand";

// PAGE-6: the bar tab card reads live pint drops, so it sends the hourly
// header every live card sends (lib/ogBrand.tsx). With no `headers`, next/og
// applies its own year-long immutable default and a crawler kept the first
// render of a pub's tab for a year.

describe("the bar tab share card's cache", () => {
  it("sends the live-card hourly header, not next/og's immutable default", async () => {
    const response = await Image({ params: Promise.resolve({ id: "venue-that-does-not-exist" }) });
    const cacheControl = response.headers.get("cache-control");
    expect(cacheControl).toBe(OG_CACHE_HEADERS["cache-control"]);
    expect(cacheControl).not.toMatch(/immutable/);
  });
});
