import "server-only";

import type { Metadata } from "next";

import {
  buildPintShareText,
  pintShareCardImageUrl,
  pintShareUrl,
  type PintShare,
} from "@/lib/pintShare";
import { isVenueDetailId, lookupVenueDetail } from "@/lib/venueDetailIndex";
import { venueAreaLabel } from "@/lib/venueDisplay";
import { venuePintShare } from "@/lib/venuePintShare";

// The server half of the pint share (lib/pintShare.ts owns the rules). The
// card and the document read the pint from the venue dataset through
// `venuePintShare`, the same exact-figure reading the /near answer and
// the pub's own sheet make, so a preview cannot show a pint the app would not.

export type ResolvedPintShare = {
  /** The pub, when the id names one. */
  venue: { id: string; name: string; area: string } | null;
  /** Its listed pint with source and day, or null when the record lacks any of them. */
  share: PintShare | null;
};

const NOTHING: ResolvedPintShare = { venue: null, share: null };

/** Never throws: an unknown id, a retired pub and a failed read all answer nothing. */
export async function resolvePintShare(venueId: string): Promise<ResolvedPintShare> {
  const id = venueId.trim();
  if (!id || !isVenueDetailId(id)) return NOTHING;
  try {
    const read = await lookupVenueDetail(id);
    if (read.status !== "found") return NOTHING;
    const { venue } = read;
    const area = venueAreaLabel(venue);
    const share = venuePintShare(venue);
    return { venue: { id: venue.id, name: venue.name, area }, share };
  } catch {
    return NOTHING;
  }
}

/**
 * The `/map` document's metadata for a pint share link, or null when the id
 * names no pub (the caller then keeps the plain map card). A pub whose pint
 * cannot carry its source and day still gets its own name, with no figure.
 */
export async function pintShareMetadata(venueId: string): Promise<Metadata | null> {
  const { venue, share } = await resolvePintShare(venueId);
  if (!venue) return null;
  const title = `${venue.name}, ${venue.area}`;
  const description = share
    ? buildPintShareText(share)
    : `${venue.name} on the PUBMAXX pub map.`;
  const url = pintShareUrl(venue.id);
  const image = pintShareCardImageUrl(venue.id);
  const alt = share ? description : `${venue.name}, ${venue.area}. PUBMAXX`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url,
      images: [{ url: image, width: 1200, height: 630, alt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
