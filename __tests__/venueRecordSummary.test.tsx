import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenueRecordSummary from "@/components/map/inspector/VenueRecordSummary";

describe("pub record summary", () => {
  it("shows the validated description and its vibe tags as a named group", () => {
    const html = renderToStaticMarkup(createElement(VenueRecordSummary, {
      copy: { description: "A Hackney pub with live music and a pub quiz.", vibeTags: ["Live music", "Pub quiz"] },
    }));
    expect(html).toContain("<p>A Hackney pub with live music and a pub quiz.</p>");
    expect(html).toContain('<div class="amenityRow" role="group" aria-label="Pub vibe">');
    expect(html).toContain('<span class="amenity">Live music</span><span class="amenity">Pub quiz</span>');
  });

  it("shows nothing when no grounded copy exists", () => {
    expect(renderToStaticMarkup(createElement(VenueRecordSummary))).toBe("");
  });
});
