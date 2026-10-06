// THE LANDING PHOTOGRAPHS OF LONDON: one owner for what a landing may show.
//
// Captain 6 Sep 2026: "I want the landing pages to show the pictures of
// London." This module is the whole policy and the whole set. It is a PURE
// LEAF (no fs, no React, no venue index) so the browser can resolve a
// photograph when the landing swaps its answer for a near-you one without
// pulling a data lane in behind it.
//
// FOUR RULES.
//
// (1) A PHOTOGRAPH IS A COMMITTED, LICENCE-RECORDED FILE, NEVER A THIRD-PARTY
//     URL. Every entry below names its photographer, its licence and the page
//     it came from, and the bytes live under /landing/london/ where
//     __tests__/publicAssetCaching.test.ts already classifies them immutable.
//     The venue lane's own photographs (lib/venueImages.ts, proxied through
//     /api/image-proxy) are deliberately NOT reachable from here: those are
//     Google Places photographs, whose terms forbid our re-hosting them, and
//     the chains' own marketing images, which nobody licensed us to re-encode.
//     scripts/landing/build-landing-photos.mjs carries that reading in full,
//     and __tests__/landingImagery.test.ts fences it.
//
// (2) NOTHING IS GENERATED AND NOTHING IS STOCK-DRESSED AS A PUB. A photograph
//     is of a REAL place, `place` says which, and `landingPhotoFor` reports the
//     SCOPE it matched at, so a page can never print a picture of the Thames
//     under a caption that reads as this pub's own front door.
//
// (3) A SLOT ALWAYS ANSWERS. The chain is the pub, then the area, then the
//     borough, then London itself. There is no "No photo yet" on a landing:
//     London is a photograph we hold for every reader.
//
// (4) TEXT OVER A PHOTOGRAPH IS AA BY CONSTRUCTION, NOT BY SAMPLING. A card
//     scrim is opaque enough that the WORST pixel a photograph could carry
//     (pure white) still clears the ratio. `landingPhotoScrimContrast` is that
//     arithmetic and the test spends it, so a new photograph can never be the
//     thing that breaks the contrast promise.

type LandingPhotoCredit = {
  author: string;
  licence: string;
  licenceUrl: string;
  sourceUrl: string;
};

export type LandingPhoto = {
  id: string;
  /** What the photograph SHOWS. Printed, so a fallback never reads as a claim. */
  place: string;
  /** Alt text, naming the place. */
  alt: string;
  width: number;
  height: number;
  /** Inline placeholder, so a card never opens as a hole. */
  blurDataUrl: string;
  credit: LandingPhotoCredit;
};

/** Which question the photograph answered. */
export type LandingPhotoScope = "pub" | "area" | "borough" | "london";

export type ResolvedLandingPhoto = {
  photo: LandingPhoto;
  scope: LandingPhotoScope;
};

/** The widths on disk. A landing asks for the narrower one on a phone. */
export const LANDING_PHOTO_WIDTHS = [640, 1280] as const;

const PHOTO_DIR = "/landing/london";

export const LANDING_PHOTOS: Record<string, LandingPhoto> = {
  "the-black-friar": {
    id: "the-black-friar",
    place: "The Black Friar, Blackfriars",
    alt: "Inside The Black Friar, the Art Nouveau pub at Blackfriars in the City of London",
    width: 1280,
    height: 720,
    blurDataUrl:
      "data:image/webp;base64,UklGRsYAAABXRUJQVlA4ILoAAACQBACdASoYAA4APu1iqU2ppaOiMAgBMB2JbACdMoRwL8AAOIBvi8Qppy68BAAA/tICtchigqo8QsUxoUb+4dlOXzMbcLJEj8fwpp9WNGgeetbUXhZ2iE7qSWvZUy89YCzOlkW+lhdjH/aaepeprbhKdmoVcCGUlG+gOh8RhoHe9TVEz0+ScZfNQz2ij83dfnf8qkjcB+Tghdef7e2P8kJJeeAPCPC4hvZ4htYkrlhfnxuJgQRxmqRAAAA=",
    credit: {
      author: "Love Art Nouveau",
      licence: "CC BY 2.0",
      licenceUrl: "https://creativecommons.org/licenses/by/2.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:The_Black_Friar_Pub,_London_(8484501967).jpg",
    },
  },
  "city-of-london": {
    id: "city-of-london",
    place: "The City of London",
    alt: "The City of London skyline seen from Tower Bridge, with the Tower of London on the north bank",
    width: 1280,
    height: 720,
    blurDataUrl:
      "data:image/webp;base64,UklGRqIAAABXRUJQVlA4IJYAAACwAwCdASoYAA4APu1iqU2ppaOiMAgBMB2JQBOgAm5A8d2nFzy8QAD+xdCrCRjHKvQutLhwhQ+AKqy7uqMT0e1Hvm6x6bf+TxbqWQ3TZnDOA3rrLkkUOpH9ZiNukBkvNo6QjgcMQT71DbzkRJVSUtWVAMaI8A/2bbyIu4YgdJCMKeeTEYhKIfK5GGktbQzmkZa74GoAAAA=",
    credit: {
      author: "Tristan Surtel",
      licence: "CC BY-SA 4.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:City_of_London,_seen_from_Tower_Bridge.jpg",
    },
  },
  "piccadilly-circus": {
    id: "piccadilly-circus",
    place: "Piccadilly Circus",
    alt: "The lit signs at Piccadilly Circus in London's West End at night",
    width: 1280,
    height: 720,
    blurDataUrl:
      "data:image/webp;base64,UklGRqwAAABXRUJQVlA4IKAAAAAQBACdASoYAA4APu1iqU2ppaOiMAgBMB2JQBOkGQBOZg6WT+uqlHkUAAD+6O4cABr/HWWtJCUd4Agm7Bmn00XRDBYlLaRjYca/zpyIDr3YrUEXKTMcv5c3rzozHk8OSsbJxA26C9TZatGkXFkx3DXsBWWUUCCmw/PD7Yh9M44PR57XZmsqu6mTmpahbNHpLbvThhuMrXv5EsV3VxOSgAAA",
    credit: {
      author: "Benjamín Núñez González",
      licence: "CC BY-SA 4.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:Piccadilly_Circus_at_night,_London,_2015.jpg",
    },
  },
  "camden-lock": {
    id: "camden-lock",
    place: "Camden Lock",
    alt: "Market stalls and the Camden Lock sign on Camden Lock Place in north London",
    width: 1280,
    height: 720,
    blurDataUrl:
      "data:image/webp;base64,UklGRrQAAABXRUJQVlA4IKgAAAAwBACdASoYAA4APu1iqU2ppaOiMAgBMB2JQBb3MYJbEMuBbr/l0IZyvQAA/oe5XzJ7qq3ikvYYJyPrU5dB/93LL86NSP98WX47d1dp8kyhYKuRioDNJfN+9lY4xYBJtrWg952mz3PbEopte+70giL8Bf9RU4lpTv+S5UV8Q0zybI2U1VpXYv51vOuB1RqCo3UDVJBkvVe5vPqIFDu8CETYtsxgGmKIAAA=",
    credit: {
      author: "Lewis Clarke",
      licence: "CC BY-SA 2.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/2.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:London_,_Camden_-_Camden_Lock_Place_-_geograph.org.uk_-_2047254.jpg",
    },
  },
  "borough-market": {
    id: "borough-market",
    place: "Borough Market, Southwark",
    alt: "Shoppers under the iron roof of Borough Market in Southwark, south London",
    width: 1280,
    height: 720,
    blurDataUrl:
      "data:image/webp;base64,UklGRqgAAABXRUJQVlA4IJwAAABwBACdASoYAA4APu1iqU2ppaOiMAgBMB2JQBgcNQA27Kd5t/KhMTu/GjMbgAD+6uny1O9GJR4n4L4shcMz+jRXEdqYywgNZAB0LbEMm3V1h2TtVX4uEpl3k/aL6ft/3adGbD1MYyzf1dcdgl7uBnTRiHFfyk4HYXG+BLvJ9dJhHOXWcgezVtceN6oQ8ldypOgAWqpD9Sb2IG5MAAA=",
    credit: {
      author: "Jeremy Keith from Brighton & Hove, United Kingdom",
      licence: "CC BY 2.0",
      licenceUrl: "https://creativecommons.org/licenses/by/2.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:Borough_Market_(4701274756).jpg",
    },
  },
  "brick-lane": {
    id: "brick-lane",
    place: "Brick Lane, Shoreditch",
    alt: "The corner of Brick Lane in Shoreditch, east London, with people on the pavement",
    width: 1280,
    height: 720,
    blurDataUrl:
      "data:image/webp;base64,UklGRp4AAABXRUJQVlA4IJIAAAAQBACdASoYAA4APu1iqU2ppaOiMAgBMB2JQAJ4AC6tFkh/lTluakkZAAD+zyaeLOc9YvwTVN491MopDYv8jmhWvIpnxOqBn4U8KXpe0FA+AXlMcoQtmGmUBqI3G000Ub+XZfD8O/MAdn73BQANEC9aN5W9m/KjieKD8Y4MvnqdimE2BVpF+Ce3kmPhBzc20gAAAA==",
    credit: {
      author: "Chris Whippet",
      licence: "CC BY-SA 2.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/2.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:Brick_Lane,_Shoreditch_-_geograph.org.uk_-_4341044.jpg",
    },
  },
  "greenwich-cutty-sark": {
    id: "greenwich-cutty-sark",
    place: "The Cutty Sark, Greenwich",
    alt: "The Cutty Sark public house on the riverside at Greenwich in south-east London",
    width: 1280,
    height: 720,
    blurDataUrl:
      "data:image/webp;base64,UklGRpoAAABXRUJQVlA4II4AAAAQBACdASoYAA4APu1iqU2ppaOiMAgBMB2JZwAD5noNSFZJ6lgKZ18wgAD+8cyPbJllV5i8UPwkpVHgBgc8VC8yf8QkxlJt+YzhMiNzVlDz0Wt9J1UDCv6P+RYek1JQidxcgPGFSY0WT4D+zAWSMtAIGrUBwj2DFOD9C3DXME3h+NfKeD7hrXgFMvqFALgA",
    credit: {
      author: "Stacey Harris",
      licence: "CC BY-SA 2.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/2.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:Cutty_Sark_public_house,_Greenwich_-_geograph.org.uk_-_2021038.jpg",
    },
  },
  "brixton": {
    id: "brixton",
    place: "Brixton",
    alt: "Market stalls under the railway bridge on Brixton Station Road in south London",
    width: 1280,
    height: 720,
    blurDataUrl:
      "data:image/webp;base64,UklGRq4AAABXRUJQVlA4IKIAAABQBACdASoYAA4APu1iqU2ppaQiMAgBMB2JYgCdGaAAVbPws3vFQ6QSyIEAAP5X9q5Y7SEN9GoalQqiMKQaf0UqNck1inIDLuFf0Iw13cL7qOKBAj0Ve5AdUFHjmq0GHQh2N+zdSBanuRirLAdittFheqL3gBfyHhrh5tFliItzzeT/J8aKzdD9ynah4IGnBWSxyokydNJJAI27NT2WPmaFkAA=",
    credit: {
      author: "Photograph by Mike Peel ( www.mikepeel.net ).",
      licence: "CC BY-SA 4.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:At_Brixton,_London_2025_002.jpg",
    },
  },
  "angel-islington": {
    id: "angel-islington",
    place: "The Old Red Lion, Angel",
    alt: "The red frontage of the Old Red Lion pub at Angel in Islington, north London",
    width: 1280,
    height: 720,
    blurDataUrl:
      "data:image/webp;base64,UklGRrAAAABXRUJQVlA4IKQAAAAwBACdASoYAA4APu1iqU2ppaOiMAgBMB2JYgCdAYwwk/nCvsDteH2V6gAAzfvBr6VMdyixCoVV+3ooT1PigYxfiimOADgM6/rDvhlfKhwL9HvCawnTBKtafNte/9lGfgSldii/j3ELMUr2fZ/wR/zWCf0+qIA6lel9wAfa+95wbrqu0x9vomu+KFaWs8NHpOAMD3TRBN+haN5CKavtDBb6uW9AAA==",
    credit: {
      author: "Adam Bruderer",
      licence: "CC BY 2.0",
      licenceUrl: "https://creativecommons.org/licenses/by/2.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:Old_Red_Lion,_Angel,_London._(2011).jpg",
    },
  },
};

/**
 * The photograph every landing falls back to. It is London itself, so a page
 * about a borough we hold no picture of still shows the city it is in.
 */
export const LONDON_PHOTO_ID = "city-of-london";

/**
 * A pub we hold a photograph OF. Keyed by curated venue id, so the landing's
 * anchor pub shows its own front room rather than a view of the city.
 */
export const PUB_PHOTOS: Record<string, string> = {
  // The Black Friar, the landing's anchor pub (lib/landingPubCard.ts).
  "venue-eltcmh": "the-black-friar",
};

/** Night-area slug (lib/nightAreas.ts) to photograph. */
export const AREA_PHOTOS: Record<string, string> = {
  camden: "camden-lock",
  islington: "angel-islington",
  greenwich: "greenwich-cutty-sark",
  shoreditch: "brick-lane",
  brixton: "brixton",
  "piccadilly-soho": "piccadilly-circus",
  "bermondsey-london-bridge": "borough-market",
};

/** Borough slug (lib/boroughs.ts `slugifyBorough`) to photograph. */
export const BOROUGH_PHOTOS: Record<string, string> = {
  "city-of-london": "city-of-london",
  westminster: "piccadilly-circus",
  camden: "camden-lock",
  southwark: "borough-market",
  islington: "angel-islington",
  "tower-hamlets": "brick-lane",
  greenwich: "greenwich-cutty-sark",
  lambeth: "brixton",
};

function photoById(id: string | undefined): LandingPhoto | null {
  return id ? (LANDING_PHOTOS[id] ?? null) : null;
}

/**
 * The photograph a landing shows, and the question it answered.
 *
 * Order is the rule: the pub itself, then the area it sits in, then its
 * borough, then London. Every argument is optional, so a borough page asks
 * with a borough slug alone and the landing hero asks with all three.
 */
export function landingPhotoFor(where: {
  venueId?: string | null;
  areaSlug?: string | null;
  boroughSlug?: string | null;
}): ResolvedLandingPhoto {
  const pub = photoById(where.venueId ? PUB_PHOTOS[where.venueId] : undefined);
  if (pub) return { photo: pub, scope: "pub" };
  const area = photoById(where.areaSlug ? AREA_PHOTOS[where.areaSlug] : undefined);
  if (area) return { photo: area, scope: "area" };
  const borough = photoById(where.boroughSlug ? BOROUGH_PHOTOS[where.boroughSlug] : undefined);
  if (borough) return { photo: borough, scope: "borough" };
  // The fallback is a real entry, so this cannot answer null.
  const london = LANDING_PHOTOS[LONDON_PHOTO_ID];
  if (!london) throw new Error(`landing photo ${LONDON_PHOTO_ID} is missing`);
  return { photo: london, scope: "london" };
}

/** `/landing/london/<id>-<width>.<format>`. */
export function landingPhotoSrc(photo: LandingPhoto, width: number, format: "avif" | "webp"): string {
  return `${PHOTO_DIR}/${photo.id}-${width}.${format}`;
}

/** The `srcset` for one format, both widths, in ascending order. */
export function landingPhotoSrcSet(photo: LandingPhoto, format: "avif" | "webp"): string {
  return LANDING_PHOTO_WIDTHS.map(
    (width) => `${landingPhotoSrc(photo, width, format)} ${width}w`,
  ).join(", ");
}

/**
 * The credit line under a photograph. One sentence, the author and the
 * licence, because a licence with no name beside it credits nobody.
 */
export function landingPhotoCreditLine(photo: LandingPhoto): string {
  return `${photo.place}. Photo: ${photo.credit.author}, ${photo.credit.licence}`;
}

/**
 * Whether the credit has to name the PLACE as well as the photographer.
 *
 * It does whenever the photograph is not of the thing the surface already
 * names: a picture of the City of London under a card headed "The Blackfriar"
 * would otherwise read as that pub's own front door. Where the picture IS the
 * pub, the heading above it has already said so.
 */
export function landingPhotoCreditNamesPlace(scope: LandingPhotoScope): boolean {
  return scope !== "pub";
}

/**
 * Alt text. A photograph of the pub says so; anything else names the place it
 * really shows, so a screen reader is told what is on the page rather than
 * what the page is about.
 */
export function landingPhotoAlt(resolved: ResolvedLandingPhoto): string {
  return resolved.photo.alt;
}

// ── The contrast contract ───────────────────────────────────────────────────
//
// A photo card is its own dark surface in BOTH themes, because the promise is
// made against the photograph rather than against the page: a theme-following
// scrim would be a different promise in each theme and only one of them could
// be proved. The numbers below are the shipped ones; app/globals.css states
// them once and components/landing/landingPhoto.css spends them.

/** The scrim colour, as sRGB 0-255. `#0C0A09`, the ink-deep end of the ramp. */
const LANDING_SCRIM_RGB = [12, 10, 9] as const;
/** How much of the scrim covers the photograph, everywhere text sits. */
export const LANDING_SCRIM_ALPHA = 0.72;
/** The ink a photo card prints its own name and figures in. */
export const LANDING_PHOTO_INK = "#FBF9F6";
/** The quieter ink for a source line or a credit. */
export const LANDING_PHOTO_INK_SOFT = "#E4DFD8";

function channelLuminance(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map(channelLuminance) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

/**
 * The contrast an ink really gets over the scrim, in the WORST case a
 * photograph can produce.
 *
 * The worst case is a pure white pixel: the scrim composites toward the photo,
 * so the lighter the photograph the lighter the surface under the ink. Passing
 * here means passing over every photograph that could ever join the set, which
 * is why this is arithmetic rather than a sample of the nine we hold.
 */
export function landingPhotoScrimContrast(
  ink: string,
  alpha: number = LANDING_SCRIM_ALPHA,
  photoPixel: readonly [number, number, number] = [255, 255, 255],
): number {
  const blend = (channel: number, pixel: number) => alpha * channel + (1 - alpha) * pixel;
  const composite: [number, number, number] = [
    blend(LANDING_SCRIM_RGB[0], photoPixel[0]),
    blend(LANDING_SCRIM_RGB[1], photoPixel[1]),
    blend(LANDING_SCRIM_RGB[2], photoPixel[2]),
  ];
  const surface = relativeLuminance(composite);
  const foreground = relativeLuminance(parseHex(ink));
  const [lighter, darker] =
    foreground > surface ? [foreground, surface] : [surface, foreground];
  return (lighter + 0.05) / (darker + 0.05);
}
