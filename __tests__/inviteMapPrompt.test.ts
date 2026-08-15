import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InviteMapPrompt } from "@/components/plan/PlanInviteRsvp";

describe("InviteMapPrompt", () => {
  it("announces a committed RSVP without inventing a map destination", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, { committed: true, venueIds: [" "] }),
    );

    expect(html).toContain("RSVP saved.");
    expect(html).not.toContain("Open these stops on the map");
  });

  it("uses the canonical selected-Venue URL for one valid Crawl Stop", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, { committed: true, venueIds: [" venue-1 "] }),
    );

    expect(html).toContain('href="/map?sel=venue-1"');
    expect(html).toContain("Open these stops on the map");
  });

  it("renders nothing before this browser commits an RSVP", () => {
    expect(
      renderToStaticMarkup(
        createElement(InviteMapPrompt, { committed: false, venueIds: ["venue-1"] }),
      ),
    ).toBe("");
  });
});
