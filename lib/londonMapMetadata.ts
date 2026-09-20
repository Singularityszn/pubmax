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
  cityMapShareUrl,
  type CityMapShareOptions,
} from "@/lib/cityShare";

const LONDON_MAP_DESCRIPTION =
  "PubMaxxing is the London pub map, with listed pint prices and crawl planning.";

export function londonMapMetadata(
  options: CityMapShareOptions = {},
): Metadata {
  const title = cityMapOgTitle("london", options);
  const shareDescription = cityMapOgDescription("london", options);
  const plainLondonDescription = cityMapOgDescription("london", {});
  const description =
    shareDescription === plainLondonDescription
      ? LONDON_MAP_DESCRIPTION
      : shareDescription;
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
