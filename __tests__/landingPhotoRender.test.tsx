import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import BoroughScreen from "@/app/borough/BoroughScreen";
import LandingHero from "@/components/landing/LandingHero";
import { landingPhotoFor, LANDING_PHOTOS, PUB_PHOTOS } from "@/lib/landingImagery";
import type { LandingArchiveIndex } from "@/lib/landingHero";
import type { LandingPubCardData } from "@/lib/landingPubCard";

// What a reader really gets (captain 6 Sep 2026): a landing carries a
// photograph of London, credited, and it never carries the venue lane's
// "No photo yet" placeholder: London is a picture we hold for everybody.

const anchorId = Object.keys(PUB_PHOTOS)[0];

const card: LandingPubCardData = {
  id: anchorId,
  name: "The Black Friar",
  area: "City of London",
  priceGbp: 6.5,
  pintName: "a pint of Pravha",
  publisher: { label: "pint-prices.com", url: "https://www.pint-prices.com/pub/x" },
  collectedOn: "2026-07-03",
  standing: "listed",
  then: {
    priceGbp: 3.6,
    observedOn: "2013-07-14",
    source: { label: "beerintheevening.com", url: "https://www.beerintheevening.com/pubs/x" },
  },
  movementLine: "Up £2.90 in 13 years.",
  mapHref: `/map?sel=${anchorId}`,
};

const archive: LandingArchiveIndex = {};

function hero(overrides: Partial<LandingPubCardData> = {}): string {
  return renderToStaticMarkup(
    createElement(LandingHero, { card: { ...card, ...overrides }, archive, rail: [] }),
  );
}

describe("the landing hero stands on a photograph", () => {
  const html = hero();
  const anchorPhoto = LANDING_PHOTOS[PUB_PHOTOS[anchorId]];

  it("shows the anchor pub's own photograph, in both formats and both widths", () => {
    expect(html).toContain(`/landing/london/${anchorPhoto.id}-640.avif 640w`);
    expect(html).toContain(`/landing/london/${anchorPhoto.id}-1280.avif 1280w`);
    expect(html).toContain(`/landing/london/${anchorPhoto.id}-640.webp 640w`);
    expect(html).toContain('type="image/avif"');
  });

  it("credits the photographer and links the licence", () => {
    expect(html).toContain(anchorPhoto.credit.author);
    expect(html).toContain(anchorPhoto.credit.licence);
    expect(html).toContain(anchorPhoto.credit.licenceUrl);
    expect(html).toContain(anchorPhoto.credit.sourceUrl);
  });

  it("names the place in the alt text", () => {
    expect(html).toContain(`alt="${anchorPhoto.alt}"`);
  });

  it("carries the placeholder inline, so the card never opens as a hole", () => {
    expect(html).toContain("data:image/webp;base64,");
  });

  it("preloads exactly one image and marks exactly one as the largest paint", () => {
    expect(html.match(/rel="preload"/g)?.length ?? 0).toBe(1);
    expect(html.match(/fetchPriority="high"|fetchpriority="high"/gi)?.length ?? 0).toBe(2);
  });

  it("never prints the venue lane's empty state on a landing", () => {
    expect(html).not.toContain("No photo yet");
  });

  it("does not name the place when the picture IS the pub the card names", () => {
    expect(html).not.toContain(`${anchorPhoto.place}.`);
  });

  it("falls back to London, and says London, for a pub we hold no picture of", () => {
    const other = hero({ id: "venue-not-in-the-set", area: "Waltham Forest" });
    const london = landingPhotoFor({}).photo;
    expect(other).toContain(`/landing/london/${london.id}-640.avif 640w`);
    // The fallback SAYS which place it is a picture of, in the card itself.
    expect(other).toContain(london.place);
    expect(other).not.toContain("No photo yet");
  });

  it("follows the answer's own borough when it holds no picture of the pub", () => {
    const camden = hero({ id: "venue-not-in-the-set", area: "Camden" });
    expect(camden).toContain("/landing/london/camden-lock-640.avif 640w");
  });
});

describe("a borough chapter carries its own photograph", () => {
  it("renders the band, its credit and its alt text", () => {
    const html = renderToStaticMarkup(
      createElement(BoroughScreen, {
        kicker: "Camden",
        title: "Pubs in Camden.",
        titleId: "boroughHeading",
        mapHref: "/map",
        mapLabel: "Open the map here",
        photo: landingPhotoFor({ boroughSlug: "camden" }),
      }),
    );
    expect(html).toContain("landingPhoto--band");
    expect(html).toContain("/landing/london/camden-lock-640.avif 640w");
    expect(html).toContain(LANDING_PHOTOS["camden-lock"].credit.author);
    expect(html).not.toContain("No photo yet");
  });

  it("renders no photograph on the index, which is a directory rather than a place", () => {
    const html = renderToStaticMarkup(
      createElement(BoroughScreen, {
        kicker: "London",
        title: "Every London borough.",
        titleId: "boroughHeading",
        mapHref: "/map",
        mapLabel: "Open the map",
      }),
    );
    expect(html).not.toContain("landingPhoto");
  });
});
