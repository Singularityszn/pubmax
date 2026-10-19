import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { pubPlacePhoto } from "@/components/listing/placePhotoRules";
import TonightHypedPubs from "@/app/tonight/TonightHypedPubs";
import type { HypedPub } from "@/lib/hypedPubs";
import { PUB_PHOTOS } from "@/lib/landingImagery";

// Photographs on /tonight (taste plan, 18 Oct 2026, change 7). A recommended
// pub shows a photograph only when we hold one OF that pub, matched by venue
// id, and it sits in the pub's own "Why this pub" fold with its credit. A pub
// with no photograph of its own gets none, never a stand-in.

const [photographedVenueId] = Object.keys(PUB_PHOTOS);

function row(venueId: string | null, name: string): HypedPub {
  return {
    name,
    area: "Blackfriars",
    venueId,
    whyLine: "People keep naming it.",
    sources: [{ label: "r/london", url: "https://example.com/thread", observedAt: new Date().toISOString() }],
    score: 1,
    mentions: 2,
  };
}

describe("TonightHypedPubs photographs", () => {
  it("shows a recommended pub's own photograph in its fold, with the credit", () => {
    expect(photographedVenueId).toBeTruthy();
    const photo = pubPlacePhoto(photographedVenueId);
    expect(photo).not.toBeNull();
    const html = renderToStaticMarkup(
      createElement(TonightHypedPubs, {
        rows: [row(photographedVenueId!, "The Black Friar"), row("venue-no-photo", "Another pub")],
        selectableVenueIds: null,
        photos: { [photographedVenueId!]: photo! },
      }),
    );
    expect(html.match(/data-photo-key=/g)).toHaveLength(1);
    expect(html).toContain(`data-photo-key="${photo!.key}"`);
    expect(html).toContain('data-photo-scope="pub"');
    // The photograph lives in the fold, after the reason.
    const fold = html.indexOf("tonightHypedReason");
    expect(fold).toBeGreaterThan(-1);
    expect(html.indexOf("tonightHypedPhoto")).toBeGreaterThan(fold);
    expect(html).toContain("Photo: ");
  });

  it("draws no photograph and no placeholder when no pub has its own", () => {
    const html = renderToStaticMarkup(
      createElement(TonightHypedPubs, {
        rows: [row("venue-no-photo", "Another pub"), row(null, "Not on the map")],
        selectableVenueIds: null,
        photos: {},
      }),
    );
    expect(html).not.toContain("placePhoto");
    expect(html).not.toContain("<img");
  });
});
