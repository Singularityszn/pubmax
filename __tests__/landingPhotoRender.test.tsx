import type { Route } from "next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

const heroData = vi.hoisted(() => ({ card: null as LandingPubCardData | null }));

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/landingPubCard.server", () => ({
  loadLandingHeroData: async () => ({
    card: heroData.card,
    archive: {},
    rail: [],
  }),
}));
vi.mock("@/lib/landingAnswers.server", () => ({
  loadLandingAnswers: async () => ({
    today: { line: "Quiet.", stamp: "Wednesday 1 October", measured: false },
    tonight: { line: "Quiet.", stamp: "Wednesday 1 October", measured: false },
  }),
}));
vi.mock("@/lib/trustedHandoffFlags.server", () => ({
  readTrustedHandoffFlag: () => false,
}));
vi.mock("@/lib/cheapestHunt.server", () => ({
  loadCheapestHunt: async () => ({ britain: null, cities: [], londonDearest: null }),
}));
vi.mock("@/components/landing/LandingPage", () => ({ default: () => null }));
vi.mock("@/components/native/AppEntryRoute", () => ({ default: () => null }));

import Home from "@/app/page";
import BoroughScreen from "@/app/borough/BoroughScreen";
import { boroughPlacePhoto } from "@/components/listing/placePhotoRules";
import LandingHero from "@/components/landing/LandingHero";
import { LANDING_PHOTOS, LONDON_PHOTO_ID, PUB_PHOTOS } from "@/lib/landingImagery";
import type { LandingArchiveIndex } from "@/lib/landingHero";
import type { LandingPubCardData } from "@/lib/landingPubCard";
import { defined } from "@/__tests__/helpers/defined";

// What a reader really gets (captain 6 Sep 2026): a landing carries a
// photograph of London, credited, and it never carries the venue lane's
// "No photo yet" placeholder: London is a picture we hold for everybody.
//
// The pub card is stricter: it shows a photograph only when we hold one OF
// that pub, keyed by its venue id. A borough or city view never stands in for
// the pub, so a card we hold no picture of prints its name, price, source and
// map link as text.

const anchorId = Object.keys(PUB_PHOTOS)[0];

const card: LandingPubCardData = {
  id: defined(anchorId),
  name: "The Black Friar",
  area: "City of London",
  primaryBorough: "City of London",
  priceGbp: 6.5,
  pintName: "a pint of Pravha",
  drinkHref: "/drink/pravha" as Route,
  publisher: { label: "pint-prices.com", url: "https://www.pint-prices.com/pub/x" },
  observedOn: "2026-07-03",
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

/** The pub card alone, so nothing else on the page answers for it. */
function answerCard(html: string): string {
  const match = html.match(/<article[^>]*aria-labelledby="lp-answer-name"[^>]*>[\s\S]*?<\/article>/);
  if (!match) throw new Error("the pub card did not render");
  return match[0];
}

describe("the home document ships no stock photograph", () => {
  // The skyline preload left with the Tower Bridge photograph (captain
  // decisions 2 and 3, 1 Nov 2026): the hero's first card is the hunt, which
  // is text, so the document itself preloads nothing and only the pub card's
  // own photograph, where there is one, is preloaded beside its picture.
  it("preloads nothing of its own on /, with or without a pub card", async () => {
    for (const next of [null, card, { ...card, id: "venue-not-in-the-set", name: "The Moon on the Hill" }]) {
      heroData.card = next;
      try {
        const html = renderToStaticMarkup(await Home());
        expect(html).not.toContain('rel="preload"');
        expect(html).not.toContain("/landing/hero-thames");
      } finally {
        heroData.card = null;
      }
    }
  });
});

describe("the landing hero stands on a photograph", () => {
  const html = hero();
  const anchorPhoto = defined(LANDING_PHOTOS[defined(PUB_PHOTOS[defined(anchorId)])]);

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

  it("carries no stock photograph, so the pub's own picture is the hero's only image", () => {
    const images = html.match(/<img [^>]*>/g) ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]).toContain('class="landingPhoto__img"');
    expect(html).not.toContain("lpLondonPhoto");
    expect(html).not.toContain("/landing/hero-thames");
  });

  it("preloads the answer photograph at every width and leaves its element lazy", () => {
    // The Thames picture was the desktop's largest paint, so this preload was
    // phone-only; with the hunt card (text) in its place, the pub's own
    // photograph is the largest image left at any width.
    const answerImg = html.match(/<img class="landingPhoto__img"[^>]*>/)?.[0] ?? "";
    expect(answerImg).toContain('loading="lazy"');
    expect(answerImg).not.toMatch(/fetchpriority="high"/i);
    const preloads = html.match(/<link rel="preload"[^>]*>/g) ?? [];
    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toContain('media="all"');
    expect(preloads[0]).toContain(`/landing/london/${anchorPhoto.id}-640.avif 640w`);
    expect(preloads[0]).toMatch(/fetchpriority="high"/i);
  });

  it("never prints the venue lane's empty state on a landing", () => {
    expect(html).not.toContain("No photo yet");
  });

  it("does not name the place when the picture IS the pub the card names", () => {
    expect(html).not.toContain(`${anchorPhoto.place}.`);
  });

  it("shows the anchor's own photograph inside the card itself", () => {
    const own = answerCard(html);
    expect(own).toContain(`/landing/london/${anchorPhoto.id}-640.avif 640w`);
    expect(own).toContain(`alt="${anchorPhoto.alt}"`);
    expect(own).toContain(anchorPhoto.credit.author);
  });
});

describe("a pub card we hold no photograph of is text and price", () => {
  // The card that showed a City of London skyline under a Sutton pub's name.
  // No photograph is keyed on this id, and we hold no view of Sutton.
  const html = hero({
    id: "venue-not-in-the-set",
    name: "The Moon on the Hill",
    area: "Sutton",
    primaryBorough: "Sutton",
    priceGbp: 4.2,
    pintName: "a pint of Ruddles",
    drinkHref: null,
  });
  const own = answerCard(html);
  const london = defined(LANDING_PHOTOS[LONDON_PHOTO_ID]);

  it("puts no photograph on the card, and preloads none", () => {
    expect(own).not.toContain("<img");
    expect(own).not.toContain("<picture");
    expect(own).not.toContain("/landing/london/");
    expect(own).not.toContain('rel="preload"');
  });

  it("never offers the city view or its credit as the pub's picture", () => {
    expect(own).not.toContain(london.alt);
    expect(own).not.toContain(london.place);
    expect(own).not.toContain(london.credit.author);
    expect(own).not.toContain("Photo: ");
  });

  it("keeps the name, the listed price, who listed it and when, and the map link", () => {
    expect(own).toContain("£4.20");
    expect(own).toContain("a pint of Ruddles");
    expect(own).toContain(
      'Listed by <a href="https://www.pint-prices.com/pub/x" target="_blank" rel="noopener noreferrer">pint-prices.com</a>, source read 3 July 2026.',
    );
    expect(own).toMatch(/<a [^>]*href="[^"]*sel=venue-not-in-the-set"[^>]*>The Moon on the Hill<\/a>/);
    expect(own).not.toContain("No photo yet");
  });

  it("leaves the hero with no image at all: no pub picture and no stock photograph", () => {
    expect(html).not.toContain("Tower Bridge");
    expect(html.match(/<img [^>]*>/g) ?? []).toHaveLength(0);
    expect(html).not.toContain('rel="preload"');
  });
});

describe("a borough or area view is never the pub's picture", () => {
  // Islington's view is the Old Red Lion, so on any other Islington pub it
  // would be a different pub's front door.
  it.each([
    ["Islington", "angel-islington"],
    ["Camden", "camden-lock"],
    ["City of London", "city-of-london"],
  ])("puts no %s view on a card for a pub we hold no photograph of", (borough, photoId) => {
    const own = answerCard(
      hero({ id: "venue-not-in-the-set", name: "The Local", area: borough, primaryBorough: borough }),
    );
    const view = defined(LANDING_PHOTOS[photoId]);
    expect(own).toContain("The Local");
    expect(own).not.toContain("<img");
    expect(own).not.toContain(`/landing/london/${view.id}-`);
    expect(own).not.toContain(view.alt);
    expect(own).not.toContain(view.credit.author);
  });

  it("does not take a pub's photograph by a matching name alone", () => {
    const friar = defined(LANDING_PHOTOS[defined(PUB_PHOTOS[defined(anchorId)])]);
    const own = answerCard(
      hero({ id: "venue-not-in-the-set", name: "The Black Friar", area: "Sutton", primaryBorough: "Sutton" }),
    );
    expect(own).toContain("The Black Friar");
    expect(own).not.toContain("<img");
    expect(own).not.toContain(`/landing/london/${friar.id}-`);
    expect(own).not.toContain(friar.alt);
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
        photo: boroughPlacePhoto("Camden") ?? undefined,
      }),
    );
    expect(html).toContain("placePhoto boroughPhoto");
    expect(html).toContain("/landing/london/camden-lock-640.avif 640w");
    expect(html).toContain(defined(LANDING_PHOTOS["camden-lock"]).credit.author);
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
    expect(html).not.toContain("placePhoto");
    expect(html).not.toContain("<picture");
  });
});
