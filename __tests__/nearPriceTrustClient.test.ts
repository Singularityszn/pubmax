import { describe, expect, it } from "vitest";

import { buildNearPriceTrustUrl } from "@/components/nearme/useNearPriceTrust";
import type { NearMeCard } from "@/lib/nearMeAnswer";

function card(id: string, price: number): NearMeCard {
  return {
    id,
    name: id,
    borough: "Westminster",
    cheapestPrice: price,
  };
}

describe("near price trust client request", () => {
  it("asks only for the five cards in the current bounded answer", () => {
    expect(buildNearPriceTrustUrl([
      card("venue-a", 3.5),
      card("venue-b", 4),
      card("venue-c", 4.5),
      card("venue-d", 5),
      card("venue-e", 5.5),
      card("venue-f", 6),
    ])).toBe(
      "/api/near-price-trust?venueId=venue-a&venueId=venue-b&venueId=venue-c&venueId=venue-d&venueId=venue-e",
    );
  });

  it("deduplicates venue IDs without sending prices or location", () => {
    const url = buildNearPriceTrustUrl([
      card("venue-a", 3.5),
      card("venue-a", 9.99),
      card("venue-b", 4),
    ]);

    expect(url).toBe("/api/near-price-trust?venueId=venue-a&venueId=venue-b");
    expect(url).not.toContain("3.5");
    expect(url).not.toContain("9.99");
    expect(url).not.toMatch(/lat|lng|borough/i);
  });

  it("does not make an empty trust request", () => {
    expect(buildNearPriceTrustUrl([])).toBeNull();
  });
});
