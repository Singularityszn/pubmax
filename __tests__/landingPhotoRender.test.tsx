import type { Route } from "next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/landingPubCard.server", () => ({
  loadLandingHeroData: async () => ({
    card: null,
    archive: {},
    rail: [],
    averages: null,
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
vi.mock("@/components/landing/LandingPage", () => ({ default: () => null }));
vi.mock("@/components/native/AppEntryRoute", () => ({ default: () => null }));

import Home from "@/app/page";
import BoroughScreen from "@/app/borough/BoroughScreen";
import LandingHero from "@/components/landing/LandingHero";
import LandingSkylinePreload from "@/components/landing/LandingSkylinePreload";
import { landingPhotoFor, LANDING_PHOTOS, PUB_PHOTOS } from "@/lib/landingImagery";
import type { LandingArchiveIndex } from "@/lib/landingHero";
import type { LandingPubCardData } from "@/lib/landingPubCard";
import { defined } from "@/__tests__/helpers/defined";

// What a reader really gets (captain 6 Sep 2026): a landing carries a
// photograph of London, credited, and it never carries the venue lane's
// "No photo yet" placeholder: London is a picture we hold for everybody.

const anchorId = Object.keys(PUB_PHOTOS)[0];

const card: LandingPubCardData = {
  id: defined(anchorId),
  name: "The Black Friar",
  area: "City of London",
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

describe("the home document ships the skyline preload", () => {
  it("mounts exactly one high-priority skyline preload on /", async () => {
    const html = renderToStaticMarkup(await Home());
    expect(html.match(/rel="preload"/g)?.length ?? 0).toBe(1);
    expect(html).toContain("/landing/hero-thames-1024.avif 1024w");
    expect(html).toContain('fetchPriority="high"');
    // Fail-soft: no answer card, so the skyline preload is not gated to desktop.
    expect(html).not.toContain('media="(min-width: 960px)"');
  });

  it("gates the skyline preload to desktop only when an answer card will render", () => {
    const preload = renderToStaticMarkup(
      createElement(LandingSkylinePreload, { phoneAnswerOwnsLcp: true }),
    );
    expect(preload).toContain('media="(min-width: 960px)"');
    const allWidths = renderToStaticMarkup(
      createElement(LandingSkylinePreload, { phoneAnswerOwnsLcp: false }),
    );
    expect(allWidths).not.toContain('media="(min-width: 960px)"');
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

  it("preloads the skyline on desktop only and keeps it the high-priority image element", () => {
    const preload = renderToStaticMarkup(
      createElement(LandingSkylinePreload, { phoneAnswerOwnsLcp: true }),
    );
    expect(preload.match(/rel="preload"/g)?.length ?? 0).toBe(1);
    expect(preload).toContain("/landing/hero-thames-1024.avif 1024w");
    expect(preload).toContain('media="(min-width: 960px)"');
    const images = html.match(/<img [^>]*>/g) ?? [];
    const highImages = images.filter((img) => /fetchpriority="high"/i.test(img));
    expect(highImages).toHaveLength(1);
    expect(highImages[0]).toContain('class="lpLondonPhoto"');
    expect(highImages[0]).toContain('decoding="sync"');
  });

  it("preloads the answer photograph on phone only and leaves its element lazy for desktop", () => {
    const answerImg = html.match(/<img class="landingPhoto__img"[^>]*>/)?.[0] ?? "";
    expect(answerImg).toContain('loading="lazy"');
    expect(answerImg).not.toMatch(/fetchpriority="high"/i);
    const preloads = html.match(/<link rel="preload"[^>]*>/g) ?? [];
    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toContain('media="(max-width: 959px)"');
    expect(preloads[0]).toContain(`/landing/london/${anchorPhoto.id}-640.avif 640w`);
    expect(preloads[0]).toMatch(/fetchpriority="high"/i);
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
  });
});
