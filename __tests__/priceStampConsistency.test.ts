import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("price-stamp signature adoption", () => {
  it.each([
    "components/feed/FeedCard.tsx",
    "components/feed/FeedSightings.tsx",
    "components/landing/PintDropStrip.tsx",
    "app/borough/page.tsx",
    "app/borough/[slug]/page.tsx",
    "components/plan/RecapDetail.tsx",
    "app/recap/[storyId]/page.tsx",
    "components/map/inspector/VenueOverviewTab.tsx",
    "components/map/UnverifiedPubSheet.tsx",
    "components/PubMap.tsx",
  ])("%s renders prices through PriceBadge", (relativePath) => {
    const source = read(relativePath);
    expect(source).toContain('import PriceBadge from "@/components/PriceBadge"');
    expect(source).toContain("<PriceBadge");
  });

  it("map pin prices use the plaque ink, surface, and signature tilt", () => {
    const source = read("components/map/canvas/buildScene.ts");
    expect(source).toContain('"text-rotate": tokens.priceStampTiltDeg');
    // The tag's ink is an expression over the pub's STANDING alone: plaque ink
    // for every sayable figure, the confirmed ink where the drop lane reads
    // confirmed (lib/pintTrust.ts). Never a band colour.
    expect(source).toContain('"text-color": pinPriceTagInkExpr(tokens)');
    expect(source).toContain("tokens.priceConfirmedInk,\n    tokens.pricePlaqueInk,");
    expect(source).toContain('"text-halo-color": tokens.pricePlaqueSurface');
  });
});
