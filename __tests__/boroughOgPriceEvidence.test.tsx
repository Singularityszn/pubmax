import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import type { PintFactStats } from "@/lib/pintFacts";

const fixture = vi.hoisted(() => ({ stats: null as PintFactStats | null, venues: [] as Venue[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pintPriceLandingDataset.server", () => ({ loadPintPriceLandingVenues: async () => fixture.venues }));
vi.mock("@/lib/pintFacts", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/pintFacts")>(),
  pintFactStats: () => fixture.stats,
}));
vi.mock("next/og", () => ({ ImageResponse: class extends Response {
  constructor(element: ReactElement) { super(renderToStaticMarkup(element)); }
} }));

import Image from "@/app/borough/[slug]/opengraph-image";

beforeEach(() => {
  fixture.venues = groupVenuePrices([4, 6, 8, null].map((price, index) => ({
    pub_name: `Pub ${index}`, address: `${index} Test Road`, latitude: 51.54, longitude: -0.145,
    primary_borough: "Camden", pint_name: "Lager", price_gbp: price,
  })) as VenuePrice[]);
  fixture.stats = {
    name: "Camden", slug: "camden", totalPubCount: 4, pubCount: 3,
    averageGbp: 6, publisherCount: 2, undatedCount: 1,
    minGbp: 4, minPubName: "Cheap", minObservedAt: "2026-07-03",
    minEvidence: { priceGbp: 4, drinkLabel: "Selected lager", servingSize: "Pint",
      publisher: { label: "Cheap pub menu", url: "https://cheap.example/menu" },
      sourceKind: "listed", observedAt: "2026-07-03", observedOn: "2026-07-03" },
    maxGbp: 8, maxPubName: "Dear", maxObservedAt: "2026-10-02",
    maxEvidence: { priceGbp: 8, drinkLabel: "Other stout", servingSize: "Pint",
      publisher: { label: "Dear pub menu", url: "https://dear.example/menu" },
      sourceKind: "listed", observedAt: "2026-10-02", observedOn: "2026-10-02" },
    oldestObservedAt: "2026-07-03", newestObservedAt: "2026-10-02",
  };
});

async function imageText() {
  const response = await Image({ params: Promise.resolve({ slug: "camden" }) });
  return (await response.text()).replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
}

describe("borough share image evidence", () => {
  it("prints the selected minimum receipt and the worked average coverage", async () => {
    const output = await imageText();
    expect(output).toContain("£4.00");
    expect(output).toContain("4pubs tracked");
    expect(output).toContain("Selected lager (Pint). Listed by Cheap pub menu, collected on 3 July 2026.");
    expect(output).not.toContain("Dear pub menu");
    expect(output).not.toContain("Other stout");
    expect(output).toContain("£6.00");
    expect(output).toContain("average across 3 listed pubs");
    expect(output).toContain("2 of 3 prices name a publisher. 2 of 3 record a full read day.");
  });

  it("prints the fact block's missing evidence words without borrowing another receipt", async () => {
    fixture.stats!.minEvidence = null;
    const output = await imageText();
    expect(output).toContain("£4.00");
    expect(output).toContain("Pint name unavailable (Serving size not recorded). Publisher not recorded, Read date unavailable.");
    expect(output).not.toContain("Dear pub menu");
  });

  it("keeps the selected day when the drink, serving and publisher are missing", async () => {
    Object.assign(fixture.stats!.minEvidence!, { drinkLabel: null, servingSize: null, publisher: null });
    const output = await imageText();
    expect(output).toContain("Pint name unavailable (Serving size not recorded). Publisher not recorded, collected on 3 July 2026.");
    expect(output).not.toContain("Dear pub menu");
  });

  it("keeps the average and both coverage counts when no minimum qualifies", async () => {
    Object.assign(fixture.stats!, { minGbp: null, minEvidence: null, minPubName: null,
      publisherCount: 0, undatedCount: 3 });
    const output = await imageText();
    expect(output).not.toContain("the cheapest tracked pint");
    expect(output).toContain("£6.00");
    expect(output).toContain("average across 3 listed pubs");
    expect(output).toContain("0 of 3 prices name a publisher. 0 of 3 record a full read day.");
  });
});
