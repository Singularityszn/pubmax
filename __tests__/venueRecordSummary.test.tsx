import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueRecordSummary from "@/components/map/inspector/VenueRecordSummary";

describe("pub record summary", () => {
  it("shows the validated description and supported vibe labels", () => {
    const html = renderToStaticMarkup(createElement(VenueRecordSummary, {
      copy: { description: "Pub in Hackney. Has a beer garden.", vibeTags: ["Beer garden", "Food served"] },
    }));
    expect(html).toContain("Pub in Hackney. Has a beer garden.");
    expect(html).toContain('aria-label="Pub vibe"');
    expect(html).toContain("Beer garden</span>");
    expect(html).toContain("Food served</span>");
  });

  it("shows nothing when no grounded copy exists", () => {
    expect(renderToStaticMarkup(createElement(VenueRecordSummary))).toBe("");
  });
});
