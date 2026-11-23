import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Venue } from "@/lib/venues";

const read = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({ readFile: read }));
// venue-test was merged into venue-kept: a read for the kept pub also finds
// what was stored under its retired id.
vi.mock("@/lib/venueAliases", () => ({
  storedVenueIds: async (id: string) => (id === "venue-kept" ? ["venue-kept", "venue-test"] : [id]),
}));
const venue = { id: "venue-test", kind: "pub", primaryBorough: "Hackney", amenities: { liveMusic: true } } as unknown as Venue;
const pack = { version: 2, model: "gemini-2.5-flash-lite", venues: {
  "venue-test": { venueId: "venue-test", borough: "Hackney", supportedTags: ["Live music"],
    description: "A Hackney pub with live music.", vibeTags: ["Live music"],
    grounding: { version: 2, verdict: "SUPPORTED", description: "A Hackney pub with live music.", vibeTags: ["Live music"], claims: [
      {phrase: "A Hackney pub with live music.", verdict: "SUPPORTED", offendingPhrase: ""},
      {phrase: "Live music", verdict: "SUPPORTED", offendingPhrase: ""},
    ] } },
} };

beforeEach(() => { vi.resetModules(); read.mockReset(); });

describe("selected venue copy reader", () => {
  it("caches the pack while revalidating supporting fields for each pub", async () => {
    read.mockResolvedValue(JSON.stringify(pack));
    const { enrichVenueWithRecordCopy } = await import("@/lib/venueRecordCopy.server");
    const [supported, changed] = await Promise.all([
      enrichVenueWithRecordCopy(venue),
      enrichVenueWithRecordCopy({ ...venue, amenities: { ...venue.amenities, liveMusic: false } }),
    ]);
    expect(supported.recordCopy).toEqual({ description: "A Hackney pub with live music.", vibeTags: ["Live music"] });
    expect(changed.recordCopy).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps a merged pub's copy under its retired id while the facts still hold", async () => {
    read.mockResolvedValue(JSON.stringify(pack));
    const { enrichVenueWithRecordCopy } = await import("@/lib/venueRecordCopy.server");
    const kept = { ...venue, id: "venue-kept" } as Venue;
    expect((await enrichVenueWithRecordCopy(kept)).recordCopy).toEqual({
      description: "A Hackney pub with live music.", vibeTags: ["Live music"],
    });
    expect((await enrichVenueWithRecordCopy({ ...kept, primaryBorough: "Camden" })).recordCopy).toBeUndefined();
    expect((await enrichVenueWithRecordCopy({ ...kept, amenities: { liveMusic: false } } as Venue)).recordCopy).toBeUndefined();
  });

  it("prefers the copy written for the current id over a retired one", async () => {
    const own = { ...pack.venues["venue-test"], venueId: "venue-kept", description: "A Hackney pub with live music on.",
      grounding: { ...pack.venues["venue-test"].grounding, description: "A Hackney pub with live music on.", claims: [
        { phrase: "A Hackney pub with live music on.", verdict: "SUPPORTED", offendingPhrase: "" },
        { phrase: "Live music", verdict: "SUPPORTED", offendingPhrase: "" },
      ] } };
    read.mockResolvedValue(JSON.stringify({ ...pack, venues: { ...pack.venues, "venue-kept": own } }));
    const { enrichVenueWithRecordCopy } = await import("@/lib/venueRecordCopy.server");
    expect((await enrichVenueWithRecordCopy({ ...venue, id: "venue-kept" } as Venue)).recordCopy?.description)
      .toBe("A Hackney pub with live music on.");
  });

  it("shows no copy for skipped or absent pubs", async () => {
    read.mockResolvedValue(JSON.stringify({ ...pack, venues: {}, skipped: { "venue-test": { reason: "invalid-copy-after-retry" } } }));
    const { enrichVenueWithRecordCopy } = await import("@/lib/venueRecordCopy.server");
    expect(await enrichVenueWithRecordCopy(venue)).toBe(venue);
  });

  it.each(["missing", "malformed", "unsupported"])('shows no copy for a %s pack', async (mode) => {
    if (mode === "missing") read.mockRejectedValue(new Error("ENOENT"));
    else read.mockResolvedValue(mode === "malformed" ? "{" : JSON.stringify({ ...pack, version: 1 }));
    const { enrichVenueWithRecordCopy } = await import("@/lib/venueRecordCopy.server");
    expect(await enrichVenueWithRecordCopy(venue)).toBe(venue);
  });
});
