// The `/map` document's own metadata, for London.
//
// Two routes render it: the prerendered shell at `/map`, and the per-request
// twin (`lib/mapDocumentTwin.ts`) that answers a share link whose card,
// title or description differs. The shell can only ever build the plain
// version, so the builder lives here rather than in either page - one owner,
// and a curated band or crawl reads identically whichever route served it.

import type { Metadata } from "next";

import {
  cityMapOgAlt,
  cityMapOgDescription,
  cityMapOgImageUrl,
  cityMapOgTitle,
  cityMapShareSelectsDescription,
  cityMapShareUrl,
  type CityMapShareOptions,
} from "@/lib/cityShare";

const LONDON_MAP_DESCRIPTION =
  "PubMaxxing is the London pub map, with listed pint prices and crawl planning.";

export function londonMapMetadata(
  options: CityMapShareOptions = {},
): Metadata {
  const title = cityMapOgTitle("london", options);
  // A crawl or band share link keeps the copy it earns; every other render of
  // this document - the prerendered shell and the per-request twin alike -
  // carries the brand description, so the two routes never disagree.
  const description = cityMapShareSelectsDescription("london", options)
    ? cityMapOgDescription("london", options)
    : LONDON_MAP_DESCRIPTION;
  const url = cityMapShareUrl("london", options);
  const image = cityMapOgImageUrl("london", options);
  const alt = cityMapOgAlt("london", options);

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
