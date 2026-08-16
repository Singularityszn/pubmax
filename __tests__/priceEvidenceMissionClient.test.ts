import { describe, expect, it, vi } from "vitest";

import {
  buildPriceEvidenceMissionUrl,
  dismissedVenueIds,
  parsePriceEvidenceMissionResponse,
  startPriceEvidenceMissionRequest,
} from "@/lib/priceEvidenceMissionClient";
import { MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS } from "@/lib/priceEvidenceMissions";

describe("buildPriceEvidenceMissionUrl", () => {
  it("asks only for bounded venue IDs", () => {
    expect(buildPriceEvidenceMissionUrl(["venue-a", "venue-b", "venue-a"]))
      .toBe("/api/price-missions?venueId=venue-a&venueId=venue-b");
  });

  it("sends no price, handle, or coordinates", () => {
    const url = buildPriceEvidenceMissionUrl(["venue-a"]);
    expect(url).not.toMatch(/handle|lat=|lng=|coord|priceGbp/i);
  });

  it("does not request an empty or over-bound list", () => {
    expect(buildPriceEvidenceMissionUrl([])).toBeNull();
    const tooMany = Array.from(
      { length: MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS + 1 },
      (_, index) => `venue-${index}`,
    );
    expect(buildPriceEvidenceMissionUrl(tooMany)).toBe(
      "/api/price-missions?" +
        tooMany.slice(0, MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS)
          .map((id) => `venueId=${id}`)
          .join("&"),
    );
  });
});

describe("parsePriceEvidenceMissionResponse", () => {
  it("accepts a ready DTO without a price or handle", () => {
    expect(parsePriceEvidenceMissionResponse({
      status: "ready",
      mission: {
        venueId: "venue-a",
        reason: "provisional",
        drinkCategory: "beer",
        observedAt: 1,
      },
    })).toEqual({
      status: "ready",
      mission: {
        venueId: "venue-a",
        reason: "provisional",
        drinkCategory: "beer",
        observedAt: 1,
      },
    });
  });

  it("accepts a degraded empty read without turning it into an empty-market claim", () => {
    expect(parsePriceEvidenceMissionResponse({
      status: "degraded",
      mission: null,
    })).toEqual({ status: "degraded", mission: null });
  });

  it("rejects smuggled price, handle, or coordinate fields", () => {
    expect(parsePriceEvidenceMissionResponse({
      status: "ready",
      mission: {
        venueId: "venue-a",
        reason: "missing",
        priceGbp: 4.2,
      },
    })).toBeNull();
    expect(parsePriceEvidenceMissionResponse({
      status: "ready",
      mission: {
        venueId: "venue-a",
        reason: "missing",
        handle: "night_owl",
      },
    })).toBeNull();
  });
});

describe("dismissedVenueIds", () => {
  it("reads venue IDs from session dismiss keys", () => {
    expect(dismissedVenueIds(new Set(["venue-a\u0000provisional\u0000beer"])))
      .toEqual(new Set(["venue-a"]));
  });
});

describe("startPriceEvidenceMissionRequest", () => {
  it("cancels an unread error response body", async () => {
    let cancelled = false;
    const fetcher = vi.fn(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("failure"));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 401 },
      ),
    );
    const request = startPriceEvidenceMissionRequest(
      "/api/price-missions?venueId=venue-a",
      fetcher,
    );
    await expect(request.promise).rejects.toThrow("price evidence mission read failed");
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });
});
