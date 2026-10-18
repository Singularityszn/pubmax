import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { SAVED_VENUE_FALLBACK_NAME } from "@/lib/savedPubs";
import {
  SAVED_VENUE_NAME_CONCURRENCY,
  SAVED_VENUE_NAME_LOOKUP_LIMIT,
  resolveSavedVenueNames,
} from "@/lib/savedVenueNames";
import type { VenueDetailLookupResult } from "@/lib/warmVenueDetail";

/**
 * A save made on this device is a venue id and a list. The profile printed the
 * id as the pub's name ("venue-s2ppfm"); lib/savedVenueNames.ts names it from
 * the map's own venue detail instead, and nothing it answers is ever an id.
 */

function found(id: string, name: string, retired?: true): VenueDetailLookupResult {
  return { status: "found", venue: { id, name, ...(retired ? { retired } : {}) } as never };
}

describe("resolveSavedVenueNames", () => {
  it("names each pub once, keeps a closed pub's own name, and never answers an id", async () => {
    const lookup = vi.fn(async (id: string): Promise<VenueDetailLookupResult> => {
      if (id === "venue-open") return found(id, "The Harp");
      if (id === "venue-closed") return found(id, "The Old Bell", true);
      if (id === "venue-broken") return { status: "failed" };
      return { status: "missing" };
    });
    const names = await resolveSavedVenueNames(
      ["venue-open", "venue-closed", "venue-gone", "venue-broken", "venue-open"],
      { lookup },
    );
    expect(lookup).toHaveBeenCalledTimes(4);
    expect(Object.fromEntries(names)).toEqual({
      "venue-open": "The Harp",
      "venue-closed": "The Old Bell",
      "venue-gone": SAVED_VENUE_FALLBACK_NAME,
      "venue-broken": SAVED_VENUE_FALLBACK_NAME,
    });
    for (const name of names.values()) expect(name).not.toMatch(/^venue-/);
  });

  it("looks up the first ids only, up to the limit, and labels the rest", async () => {
    const ids = Array.from({ length: SAVED_VENUE_NAME_LOOKUP_LIMIT + 5 }, (_, i) => `venue-${i}`);
    const lookup = vi.fn(async (id: string) => found(id, `Pub ${id}`));
    const names = await resolveSavedVenueNames(ids, { lookup });
    expect(lookup).toHaveBeenCalledTimes(SAVED_VENUE_NAME_LOOKUP_LIMIT);
    expect(names.get("venue-0")).toBe("Pub venue-0");
    expect(names.get(`venue-${SAVED_VENUE_NAME_LOOKUP_LIMIT}`)).toBe(SAVED_VENUE_FALLBACK_NAME);
  });

  it("never has more lookups in flight than the concurrency allows", async () => {
    let inFlight = 0;
    let peak = 0;
    const lookup = vi.fn(async (id: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return found(id, id.toUpperCase());
    });
    await resolveSavedVenueNames(
      Array.from({ length: 12 }, (_, i) => `v${i}`),
      { lookup },
    );
    expect(peak).toBeLessThanOrEqual(SAVED_VENUE_NAME_CONCURRENCY);
    expect(lookup).toHaveBeenCalledTimes(12);
  });

  it("stops asking once the read is abandoned", async () => {
    const controller = new AbortController();
    const lookup = vi.fn(async (id: string) => {
      controller.abort();
      return found(id, "The Harp");
    });
    await resolveSavedVenueNames(["a", "b", "c", "d", "e", "f"], {
      lookup,
      signal: controller.signal,
      concurrency: 1,
    });
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

describe("the profile's device saves", () => {
  it("are named through resolveSavedVenueNames, never by their id", () => {
    const source = readFileSync(
      join(process.cwd(), "app/u/[handle]/ProfilePageClient.tsx"),
      "utf8",
    );
    expect(source).toContain("resolveSavedVenueNames(");
    expect(source).not.toMatch(/venueName:\s*pub\.venueId/);
  });
});
