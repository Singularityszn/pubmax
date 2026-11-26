import { afterEach, describe, expect, it, vi } from "vitest";

import { shortlistOptionView, shortlistView, type PlanShortlist, type ShortlistOption } from "@/lib/planShortlist";

const option: ShortlistOption = {
  venueId: "pub-a", venueName: "Pub A", lat: 51.5, lng: -0.1,
  listedPint: {
    priceGbp: 5, pintName: "Lager", observedOn: "2026-01-01",
    publisher: { label: "Pub menu", url: "https://example.com/menu" },
  },
  reasons: ["In the Bank search area", "Listed pint meets the per-pint limit"],
};

afterEach(() => vi.useRealTimers());

describe("shortlist prices follow the existing 180-day listed-price authority window", () => {
  it("keeps evidence at day 179 and removes it at day 181 without changing the saved record", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T00:00:00Z"));
    const saved: PlanShortlist = {
      options: [structuredClone(option)], expiresAt: "2026-07-06T00:00:00Z", votes: { voter: "pub-a" }, confirmed: null,
    };
    expect(shortlistView(saved, "voter").options[0]?.listedPint?.priceGbp).toBe(5);
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    const view = shortlistView(saved, "voter");
    expect(view.options[0]?.listedPint).toBeNull();
    expect(view.options[0]?.reasons).toEqual([
      "In the Bank search area", "No current listed pint to check against the limit",
    ]);
    expect(view.counts).toEqual({ "pub-a": 1 });
    expect(view.myVote).toBe("pub-a");
    expect(saved.options[0]?.listedPint?.priceGbp).toBe(5);
  });

  it("keeps the last authorised instant and removes evidence one millisecond later", () => {
    const expiry = Date.parse("2026-06-30T00:00:00Z");
    expect(shortlistOptionView(option, expiry).listedPint?.priceGbp).toBe(5);
    expect(shortlistOptionView(option, expiry + 1).listedPint).toBeNull();
  });

  it.each([null, "invalid", "2027-01-01"])("refuses undated, invalid or future evidence: %s", (observedOn) => {
    const candidate = { ...option, listedPint: { ...option.listedPint!, observedOn } };
    expect(shortlistOptionView(candidate, Date.parse("2026-07-01T00:00:00Z")).listedPint).toBeNull();
  });

  it.each(["Listed pint meets the per-pint limit", "Listed pint exceeds the per-pint limit"])(
    "removes the stale comparison: %s", (reason) => {
      const current = shortlistOptionView({ ...option, reasons: [reason] }, Date.parse("2026-07-01T00:00:00Z"));
      expect(current.reasons).toEqual(["No current listed pint to check against the limit"]);
    },
  );
});
