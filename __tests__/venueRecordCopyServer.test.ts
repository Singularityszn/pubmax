import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Venue } from "@/lib/venues";

const read = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({ readFile: read }));
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
    expect((await enrichVenueWithRecordCopy(venue)).recordCopy).toEqual({
      description: "A Hackney pub with live music.", vibeTags: ["Live music"],
    });
    expect((await enrichVenueWithRecordCopy({ ...venue, amenities: { ...venue.amenities, liveMusic: false } })).recordCopy).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
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
