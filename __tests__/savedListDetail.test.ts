import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SavedListDetail from "@/components/profile/SavedListDetail";

describe("SavedListDetail", () => {
  it("renders an authored custom list with attribution, counts, and pub links", () => {
    const html = renderToStaticMarkup(
      createElement(SavedListDetail, {
        ownerHandle: "sam",
        listType: "my locals",
        pubs: [
          {
            venueId: "venue-1",
            venueName: "The Test Arms",
            venueMapUrl: "/map?sel=venue-1",
            listType: "my locals",
            note: "Quiet corner table.",
            savedAt: "2026-07-07T12:00:00.000Z",
          },
        ],
        initialCounts: { followers: 4, savedPubs: 1 },
      }),
    );

    expect(html).toContain("my locals");
    expect(html).toContain("By @sam");
    expect(html).toContain('href="/u/sam"');
    expect(html).toContain("1 pub");
    expect(html).toContain("4 followers");
    expect(html).toContain("The Test Arms");
    expect(html).toContain("Quiet corner table.");
    expect(html).toContain('href="/map?sel=venue-1"');
    expect(html).toContain('aria-label="Share this"');
    expect(html).toContain("Share");
    expect(html).toContain(
      "sam&#x27;s my locals saved list — 1 pub, 4 followers. Every pint has a story.",
    );
    expect(html).toContain("%2Fu%2Fsam%2Flists%2Fmy%2520locals");
  });

  it("shows a follow control only when a different viewer handle is supplied", () => {
    const html = renderToStaticMarkup(
      createElement(SavedListDetail, {
        ownerHandle: "sam",
        viewerHandle: "ken",
        listType: "Date Night",
        pubs: [],
        initialCounts: { followers: 0, savedPubs: 0 },
      }),
    );
    const ownHtml = renderToStaticMarkup(
      createElement(SavedListDetail, {
        ownerHandle: "sam",
        viewerHandle: "sam",
        listType: "Date Night",
        pubs: [],
        initialCounts: { followers: 0, savedPubs: 0 },
      }),
    );

    expect(html).toContain("Follow list");
    expect(ownHtml).not.toContain("Follow list");
  });
});
