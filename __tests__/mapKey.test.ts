import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MapKey from "@/components/map/MapKey";
import { mapPriceLegend } from "@/lib/mapPriceLegend";

describe("MapKey", () => {
  const html = renderToStaticMarkup(
    createElement(MapKey, {
      legend: mapPriceLegend({
        kind: "default",
        hasTypeRelativePrices: false,
      }),
    }),
  );

  it("pairs every colour band with a symbol and visible price text", () => {
    expect(html).toContain("£5.50 or less");
    expect(html).toContain("Over £5.50, up to £7");
    expect(html).toContain("Over £7");
    expect(html).toContain("No pint price on the map");
    expect(html).toContain("mapKeyPriceCode");
    expect(html).toContain("Your approximate location");
    expect(html).toContain("Place in the Events overlay for tonight");
    expect(html).toContain("UK base pub you selected");
  });

  it("keeps decorative colour and shape samples out of the accessibility tree", () => {
    expect(html).toContain('class="mapKeyPriceSwatch');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("One recent pint report");
    expect(html).toContain("This pub has a visible Pint Drop");
  });

  it("uses semantic sections and expandable detail groups", () => {
    expect(html).toContain("<h3");
    expect(html).toContain("<details");
    expect(html).toContain("<summary>Pin shapes</summary>");
    expect(html).toContain("<summary>Dots and rings</summary>");
    expect(html).toContain("<summary>Routes</summary>");
    expect(html).toContain("Broad translucent line");
    expect(html).toContain("place story you chose");
  });

  it("draws routed, estimated, and story lines as different marks", () => {
    const css = readFileSync(
      join(process.cwd(), "components/map/mapKey.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.mapKeyMarker--walking-route::before\s*{[^}]*height:\s*3px/,
    );
    expect(css).toMatch(
      /\.mapKeyMarker--straight-route::before\s*{[^}]*border-top:\s*3px dashed/,
    );
    expect(css).toMatch(
      /\.mapKeyMarker--story-corridor::before\s*{[^}]*height:\s*12px[^}]*filter:\s*blur\(2px\)/,
    );
  });
});
