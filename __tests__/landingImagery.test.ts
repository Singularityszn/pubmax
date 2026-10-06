import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { slugifyBorough } from "@/lib/boroughs";
import {
  AREA_PHOTOS,
  BOROUGH_PHOTOS,
  landingPhotoAlt,
  landingPhotoCreditLine,
  landingPhotoCreditNamesPlace,
  landingPhotoFor,
  landingPhotoScrimContrast,
  landingPhotoSrc,
  landingPhotoSrcSet,
  LANDING_PHOTOS,
  LANDING_PHOTO_INK,
  LANDING_PHOTO_INK_SOFT,
  LANDING_PHOTO_WIDTHS,
  LANDING_SCRIM_ALPHA,
  LONDON_PHOTO_ID,
  PUB_PHOTOS,
} from "@/lib/landingImagery";
import { LANDING_PUB_PREFERENCE } from "@/lib/landingPubCard";
import { LONDON_BOROUGH_NAMES } from "@/lib/londonBoroughNames.mjs";
import { LONDON_NIGHT_AREA_SLUGS } from "@/lib/nightAreas";
import { defined } from "@/__tests__/helpers/defined";

// The landing photographs of London (captain 6 Sep 2026). What this holds:
// every picture is a licensed file we ship, every slot answers, and every line
// printed over one clears WCAG AA against the worst pixel a photograph could
// carry, proved by arithmetic rather than by sampling the nine we happen to
// hold today.

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const ids = Object.keys(LANDING_PHOTOS);

const ALLOWED_LICENCE = /^(CC BY(-SA)? [0-9.]+|CC0|Public domain|PDM)/i;

describe("the landing photographs are files we hold", () => {
  it("ships every width and both formats for every photograph", () => {
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      for (const width of LANDING_PHOTO_WIDTHS) {
        for (const format of ["avif", "webp"] as const) {
          const src = landingPhotoSrc(defined(LANDING_PHOTOS[id]), width, format);
          const file = join(root, "public", src.replace(/^\//, ""));
          expect(existsSync(file), `${src} is on disk`).toBe(true);
          expect(statSync(file).size).toBeGreaterThan(1_000);
        }
      }
    }
  });

  it("keeps the phone's own file inside the landing weight budget", () => {
    // One landing fetches ONE photograph. 150 KB is the whole added weight a
    // landing may carry on a phone, so the narrow AVIF has to sit well under it.
    for (const id of ids) {
      const file = join(
        root,
        "public",
        landingPhotoSrc(defined(LANDING_PHOTOS[id]), LANDING_PHOTO_WIDTHS[0], "avif").replace(/^\//, ""),
      );
      expect(statSync(file).size, `${id} narrow AVIF`).toBeLessThan(60_000);
    }
  });

  it("records a photographer, a licence and both links for every photograph", () => {
    for (const id of ids) {
      const { credit, place, alt, blurDataUrl } = defined(LANDING_PHOTOS[id]);
      expect(credit.author.length, `${id} author`).toBeGreaterThan(2);
      expect(credit.licence, `${id} licence`).toMatch(ALLOWED_LICENCE);
      expect(credit.licenceUrl, `${id} licence url`).toMatch(/^https:\/\//);
      expect(credit.sourceUrl, `${id} source url`).toMatch(
        /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/,
      );
      expect(place.length, `${id} names what it shows`).toBeGreaterThan(2);
      expect(alt.toLowerCase(), `${id} alt names London`).toMatch(/london/);
      expect(blurDataUrl.startsWith("data:image/webp;base64,")).toBe(true);
      // The placeholder is inline in the document, so it has to stay tiny.
      expect(blurDataUrl.length).toBeLessThan(1_500);
    }
  });

  it("names every photograph in the attribution record beside the bytes", () => {
    const attribution = read("public/landing/london/ATTRIBUTION.md");
    for (const id of ids) {
      expect(attribution, `${id} in ATTRIBUTION.md`).toContain(`\`${id}\``);
      expect(attribution).toContain(defined(LANDING_PHOTOS[id]).credit.author);
    }
  });
});

describe("a landing photograph is never a third-party URL", () => {
  // The venue lane's photographs are Google Places images and the chains' own
  // marketing files, hotlinked through /api/image-proxy. Neither may be
  // re-hosted here: the terms of one forbid it and nobody licensed the other.
  it("keeps the image proxy and the venue image lane out of the landing lane", () => {
    for (const path of [
      "lib/landingImagery.ts",
      "components/landing/LandingPhoto.tsx",
    ]) {
      // Both files ARGUE about the proxy in prose, so the fence reads code.
      const code = read(path)
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
        .join("\n");
      expect(code, `${path} does not proxy`).not.toMatch(/\/api\/image-proxy/);
      expect(code, `${path} does not reach the venue image lane`).not.toMatch(
        /from "@\/lib\/venueImages"/,
      );
    }
  });

  it("serves every photograph from our own /landing/london directory", () => {
    for (const id of ids) {
      for (const format of ["avif", "webp"] as const) {
        expect(landingPhotoSrcSet(defined(LANDING_PHOTOS[id]), format)).not.toMatch(/https?:/);
        expect(landingPhotoSrc(defined(LANDING_PHOTOS[id]), 640, format)).toMatch(
          /^\/landing\/london\//,
        );
      }
    }
  });
});

describe("a slot always answers", () => {
  it("resolves the pub, then the area, then the borough, then London", () => {
    const pubId = Object.keys(PUB_PHOTOS)[0];
    expect(
      landingPhotoFor({ venueId: pubId, areaSlug: "camden", boroughSlug: "camden" }),
    ).toMatchObject({ scope: "pub", photo: { id: PUB_PHOTOS[defined(pubId)] } });
    expect(landingPhotoFor({ areaSlug: "camden", boroughSlug: "southwark" })).toMatchObject({
      scope: "area",
      photo: { id: AREA_PHOTOS.camden },
    });
    expect(landingPhotoFor({ boroughSlug: "southwark" })).toMatchObject({
      scope: "borough",
      photo: { id: BOROUGH_PHOTOS.southwark },
    });
  });

  it("answers London for a place we hold no picture of, and for nothing at all", () => {
    for (const where of [
      {},
      { venueId: "venue-not-here" },
      { areaSlug: "nowhere", boroughSlug: "nowhere" },
      { boroughSlug: slugifyBorough("Waltham Forest") },
    ]) {
      const resolved = landingPhotoFor(where);
      expect(resolved.scope).toBe("london");
      expect(resolved.photo.id).toBe(LONDON_PHOTO_ID);
    }
  });

  it("names the place in the credit unless the picture IS the thing named", () => {
    // A picture of the City of London under a card headed "The Blackfriar"
    // would read as that pub's own front door, so the credit says which it is.
    expect(landingPhotoCreditNamesPlace("london")).toBe(true);
    expect(landingPhotoCreditNamesPlace("borough")).toBe(true);
    expect(landingPhotoCreditNamesPlace("area")).toBe(true);
    expect(landingPhotoCreditNamesPlace("pub")).toBe(false);
  });

  it("prints what the photograph really shows, so a fallback claims nothing", () => {
    const london = landingPhotoFor({ boroughSlug: "nowhere" });
    expect(landingPhotoCreditLine(london.photo)).toContain(london.photo.place);
    expect(landingPhotoCreditLine(london.photo)).toContain(london.photo.credit.author);
    expect(landingPhotoAlt(london)).toBe(london.photo.alt);
  });
});

describe("every key in the routing tables names a real place", () => {
  it("keys the pub table on a pub the landing can actually anchor on", () => {
    for (const venueId of Object.keys(PUB_PHOTOS)) {
      expect(LANDING_PUB_PREFERENCE, `${venueId} is a landing anchor`).toContain(venueId);
    }
  });

  it("keys the area table on real night-area slugs", () => {
    for (const slug of Object.keys(AREA_PHOTOS)) {
      expect(LONDON_NIGHT_AREA_SLUGS as readonly string[], slug).toContain(slug);
    }
  });

  it("keys the borough table on real London borough slugs", () => {
    const slugs = (LONDON_BOROUGH_NAMES as readonly string[]).map(slugifyBorough);
    for (const slug of Object.keys(BOROUGH_PHOTOS)) {
      expect(slugs, slug).toContain(slug);
    }
  });

  it("points every table at a photograph that exists", () => {
    for (const id of [
      ...Object.values(PUB_PHOTOS),
      ...Object.values(AREA_PHOTOS),
      ...Object.values(BOROUGH_PHOTOS),
      LONDON_PHOTO_ID,
    ]) {
      expect(LANDING_PHOTOS[id], id).toBeTruthy();
    }
  });
});

describe("text over a photograph clears WCAG AA against the worst pixel", () => {
  it("passes for both inks over a pure-white photograph", () => {
    // Pure white is the worst case: the scrim composites toward the photo, so
    // the lighter the picture the lighter the surface under the ink.
    expect(landingPhotoScrimContrast(LANDING_PHOTO_INK)).toBeGreaterThanOrEqual(4.5);
    expect(landingPhotoScrimContrast(LANDING_PHOTO_INK_SOFT)).toBeGreaterThanOrEqual(4.5);
  });

  it("passes over a black photograph too, so neither end of the range fails", () => {
    for (const ink of [LANDING_PHOTO_INK, LANDING_PHOTO_INK_SOFT]) {
      expect(landingPhotoScrimContrast(ink, LANDING_SCRIM_ALPHA, [0, 0, 0])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("agrees with itself: the textbook pair computes 21:1", () => {
    // No scrim at all over a white photograph, in black ink: the published
    // maximum. A wrong luminance formula moves it.
    expect(landingPhotoScrimContrast("#000000", 0, [255, 255, 255])).toBeCloseTo(21, 1);
  });

  it("ships the alpha it proves, and never a weaker one under text", () => {
    const css = read("components/landing/landingPhoto.css");
    const alphas = [...css.matchAll(/rgb\(12 10 9 \/ ([0-9.]+)\)/g)].map((m) => Number(m[1]));
    expect(alphas.length).toBeGreaterThan(0);
    // Every alpha that sits under a line of text is the proved one or deeper.
    const scrim = css.slice(css.indexOf(".landingPhoto__scrim"), css.indexOf(".landingPhotoCredit"));
    const scrimAlphas = [...scrim.matchAll(/rgb\(12 10 9 \/ ([0-9.]+)\)/g)].map((m) => Number(m[1]));
    for (const alpha of scrimAlphas) {
      expect(alpha, "card scrim alpha").toBeGreaterThanOrEqual(LANDING_SCRIM_ALPHA);
    }
    // The band's own credit brings the same alpha as its own surface.
    expect(css).toMatch(/\.landingPhoto--band \.landingPhotoCredit \{[^}]*rgb\(12 10 9 \/ 0\.72\)/);
  });
});
