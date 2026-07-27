import type { Metadata } from "next";

import PintIndexMapArrival from "@/components/pintindex/PintIndexMapArrival";
import PubMaxingShell from "@/components/PubMaxingShell";
import { readTrustedHandoffFlags } from "@/lib/trustedHandoffFlags.server";
import {
  cityMapOgAlt,
  cityMapOgDescription,
  cityMapOgImageUrl,
  cityMapOgTitle,
  cityMapShareUrl,
  firstSearchParam,
  stopCountFromPubsParam,
} from "@/lib/cityShare";
import {
  parseUkPlaceMapArrival,
  ukPlaceMapUrl,
} from "@/lib/ukPlaceSearch";

// /map stays London for back-compat bookmarks. Other cities live at /map/[city].

type MapPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  searchParams,
}: MapPageProps): Promise<Metadata> {
  const sp = searchParams ? await searchParams : undefined;
  const placeArrival = parseUkPlaceMapArrival(
    new URLSearchParams({
      place: firstSearchParam(sp?.place) ?? "",
      lat: firstSearchParam(sp?.lat) ?? "",
      lng: firstSearchParam(sp?.lng) ?? "",
    }),
  );
  if (placeArrival) {
    const title = `${placeArrival.name} pub map`;
    const description =
      `Browse pubs mapped in ${placeArrival.name}. ` +
      "No prices have been logged here yet.";
    const url = ukPlaceMapUrl(placeArrival);
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        url,
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  }
  const band = firstSearchParam(sp?.band);
  const crawl = firstSearchParam(sp?.crawl);
  const stopCount = stopCountFromPubsParam(firstSearchParam(sp?.pubs));
  const opts = { band, crawl, stopCount };
  const title = cityMapOgTitle("london", opts);
  const description = cityMapOgDescription("london", opts);
  const url = cityMapShareUrl("london", opts);
  const image = cityMapOgImageUrl("london", opts);
  const alt = cityMapOgAlt("london", opts);

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

export default function MapPage() {
  return (
    <>
      <PubMaxingShell cityId="london" flags={readTrustedHandoffFlags()} />
      {/* Records that a Pint Index arrival reached the map. Renders nothing and
          owns no map state; it only reads its own arrival marker off the URL. */}
      <PintIndexMapArrival />
    </>
  );
}
