import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pubMap = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
const priceControl = readFileSync(
  join(process.cwd(), "components/map/MapPriceControl.tsx"),
  "utf8",
);
const priceCss = readFileSync(
  join(process.cwd(), "components/map/mapPriceControl.css"),
  "utf8",
);
const conciergeCss = readFileSync(
  join(process.cwd(), "components/map/mapConciergeAsk.css"),
  "utf8",
);

describe("mobile map price chrome", () => {
  it("places the compact price key in the map header", () => {
    expect(pubMap).toContain('mobileMapUtility={');
    expect(pubMap).toContain('placement="header"');
    expect(priceControl).toContain('"map" | "header"');
  });

  it("removes the separate bottom price stack on phones", () => {
    expect(priceCss).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.mapPriceControl--map\s*{\s*display:\s*none/);
    expect(priceCss).toContain(".mapPriceControl--header .mapPriceLegend");
  });

  it("keeps the remaining bottom actions clear of primary navigation", () => {
    expect(conciergeCss).toContain(
      "bottom: calc(var(--mobile-tab-clearance, 72px) + 28px)",
    );
  });
});
