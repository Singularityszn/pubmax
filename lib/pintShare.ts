// ONE HONEST SHARE MOMENT: a listed pint, its pub, and who listed it when.
//
// Product owner, Oct 2026 UX audit (P2-C). A reader looking at a cheap listed
// pint (the top answer on /near, the price block of a pub's own sheet) gets
// one quiet "Share this pint" action. What it shares, and what the link
// preview draws, is decided HERE and nowhere else, so the message and the
// card cannot tell two stories about one pint.
//
// THREE RULES.
//   1. A FIGURE NEVER TRAVELS WITHOUT ITS SOURCE AND ITS DAY. `pintShareFrom`
//      answers null unless it holds a positive price, a named publisher AND the
//      day that publisher's row was read. No share is offered on null, and the
//      card draws no figure on null. Nothing here invents either half.
//   2. THE CARD READS THE PINT, NEVER THE LINK. The share URL carries the venue
//      id and a card flag, never a price: a figure in a query string is a
//      figure anybody can type. The card route resolves the price from the
//      venue dataset through the same reading /near and the sheet make
//      (`resolveNearPriceTrust`).
//   3. THIS IS A PUB'S CARD, NOT THE HOMEPAGE'S. The homepage share card holds
//      no figure of its own (docs/rules/app-landing-city-and-listing-pages.md);
//      that rule is about the invite preview and is untouched by this one.
//
// Pure and client-safe: no React, no fs, no store.

import type { Metadata, Route } from "next";

import { cityAwareMapPath } from "@/lib/cityMapHref";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import { formatGbp } from "@/lib/formatGbp";
import { formatTrustDay } from "@/lib/trustPill";

/** The `/map` query key that asks the document for a pint card. */
export const PINT_SHARE_CARD_PARAM = "card";
/** Its one value. Any other value is no card at all. */
export const PINT_SHARE_CARD_VALUE = "pint";

/** The action's words, said once. */
export const PINT_SHARE_LABEL = "Share this pint";

export type PintShareInput = {
  venueId: string | null | undefined;
  name: string | null | undefined;
  area?: string | null;
  priceGbp: number | null | undefined;
  /** Publisher label of the row carrying this exact figure. */
  publisher: string | null | undefined;
  /** ISO instant that row was last read at its source. */
  observedAt: string | null | undefined;
};

export type PintShare = {
  venueId: string;
  name: string;
  area: string | null;
  priceGbp: number;
  publisher: string;
  /** "2 Oct" in London time: the publisher row's own read, never a collection day. */
  readDay: string;
};

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * The share a pint has earned, or null. Null whenever any of the price, the
 * publisher or the read day is missing or unreadable: a price without its
 * source and day is not shared, and a source without a price is nothing to
 * share.
 */
export function pintShareFrom(input: PintShareInput): PintShare | null {
  const venueId = clean(input.venueId);
  const name = clean(input.name);
  const publisher = clean(input.publisher);
  const price = input.priceGbp;
  if (!venueId || !name || !publisher) return null;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  const readMs = input.observedAt ? Date.parse(input.observedAt) : Number.NaN;
  if (!Number.isFinite(readMs)) return null;
  const area = clean(input.area) || null;
  return {
    venueId,
    name,
    area,
    priceGbp: price,
    publisher,
    readDay: formatTrustDay(readMs),
  };
}

/** "listed by whatpub.com, 2 Oct": the half that may never be dropped. */
export function pintShareSourceLine(share: PintShare): string {
  return `listed by ${share.publisher}, ${share.readDay}`;
}

/** "£2.99 a pint at The Crosse Keys (listed by whatpub.com, 2 Oct)." */
export function buildPintShareText(share: PintShare): string {
  return `${formatGbp(share.priceGbp)} a pint at ${share.name} (${pintShareSourceLine(share)}).`;
}

/** The pub's own map link, asking the document for this pint's card. */
export function pintShareUrl(venueId: string): Route {
  return cityAwareMapPath(
    cityIdFromVenueId(venueId),
    `sel=${encodeURIComponent(venueId)}&${PINT_SHARE_CARD_PARAM}=${PINT_SHARE_CARD_VALUE}`,
  );
}

/** The card image a pint share link previews. The id is all it is told. */
export function pintShareCardImageUrl(venueId: string): string {
  return `/api/pint-card?venue=${encodeURIComponent(venueId)}`;
}

/** Whether a `/map` query asks for a pint card, and for which venue. */
export function pintShareCardVenue(
  card: string | null | undefined,
  sel: string | null | undefined,
): string | null {
  if (clean(card).toLowerCase() !== PINT_SHARE_CARD_VALUE) return null;
  const id = clean(sel);
  return id || null;
}

const PINT_SHARE_TITLE = "A listed pint on the PUBMAXX map";
const PINT_SHARE_DESCRIPTION =
  "The price, the pub and who listed it when. Open it on the PUBMAXX map.";

/**
 * The `/map` document's metadata for a pint share link. It reads NOTHING: the
 * words name no figure, and the card (`/api/pint-card`) is the one place the
 * pint is read and drawn, so the per-request map document carries no venue
 * pack into its function (`__tests__/mapPlaceTracing.test.ts`).
 */
export function pintShareMetadata(venueId: string): Metadata {
  const url = pintShareUrl(venueId);
  const image = pintShareCardImageUrl(venueId);
  return {
    title: PINT_SHARE_TITLE,
    description: PINT_SHARE_DESCRIPTION,
    openGraph: {
      title: PINT_SHARE_TITLE,
      description: PINT_SHARE_DESCRIPTION,
      type: "website",
      url,
      images: [{ url: image, width: 1200, height: 630, alt: PINT_SHARE_TITLE }],
    },
    twitter: {
      card: "summary_large_image",
      title: PINT_SHARE_TITLE,
      description: PINT_SHARE_DESCRIPTION,
      images: [image],
    },
  };
}
