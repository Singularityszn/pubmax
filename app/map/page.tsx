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
import { resolveUkPlaceMapArrival } from "@/lib/ukPlaceIndex.server";
import {
  UK_NATIONAL_BROWSE_COPY,
  UK_NATIONAL_MAP_HREF,
  isUkNationalBrowse,
} from "@/lib/ukNationalBrowse";
import { ukPlaceMapUrl } from "@/lib/ukPlaceSearch";

// /map stays London for back-compat bookmarks. Other cities live at /map/[city].
// An uncovered UK town is not a city route: it rides /map as a `?place=` arrival
// resolved server-side against the place index, so no curated pack is implied.

type MapPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function placeArrivalFor(
  sp: Record<string, string | string[] | undefined> | undefined,
) {
  return resolveUkPlaceMapArrival(
    new URLSearchParams({
      place: firstSearchParam(sp?.place) ?? "",
      lat: firstSearchParam(sp?.lat) ?? "",
      lng: firstSearchParam(sp?.lng) ?? "",
    }),
  );
}

function nationalBrowseFor(
  sp: Record<string, string | string[] | undefined> | undefined,
  placeArrival: ReturnType<typeof placeArrivalFor>,
) {
  if (placeArrival) return false;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp ?? {})) {
    const first = firstSearchParam(value);
    if (first) params.set(key, first);
  }
  return isUkNationalBrowse(params);
}

export async function generateMetadata({
  searchParams,
}: MapPageProps): Promise<Metadata> {
  const sp = searchParams ? await searchParams : undefined;
  const placeArrival = placeArrivalFor(sp);
  if (nationalBrowseFor(sp, placeArrival)) {
    const title = UK_NATIONAL_BROWSE_COPY.title;
    const description = UK_NATIONAL_BROWSE_COPY.body;
    return {
      title,
      description,
      alternates: { canonical: "/map" },
      openGraph: {
        title,
        description,
        type: "website",
        url: UK_NATIONAL_MAP_HREF,
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  }
  if (placeArrival) {
    const title = `${placeArrival.name} pub map`;
    const description =
      `Browse pubs mapped in ${placeArrival.name}. ` +
      "No prices have been logged here yet.";
    const url = ukPlaceMapUrl(placeArrival);
    return {
      title,
      description,
      // One place per query string is an unbounded URL space with no page of
      // its own to rank, so the crawlable address stays /map.
      alternates: { canonical: "/map" },
      robots: { index: false, follow: true },
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

export default async function MapPage({ searchParams }: MapPageProps) {
  const sp = searchParams ? await searchParams : undefined;
  const placeArrival = placeArrivalFor(sp);
  return (
    <>
      <PubMaxingShell
        cityId="london"
        flags={readTrustedHandoffFlags()}
        placeArrival={placeArrival}
        ukNationalBrowse={nationalBrowseFor(sp, placeArrival)}
      />
      {/* Records that a Pint Index arrival reached the map. Renders nothing and
          owns no map state; it only reads its own arrival marker off the URL. */}
      <PintIndexMapArrival />
    </>
  );
}
