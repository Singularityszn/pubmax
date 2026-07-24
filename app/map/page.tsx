import type { Metadata } from "next";

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

// /map stays London for back-compat bookmarks. Other cities live at /map/[city].

type MapPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  searchParams,
}: MapPageProps): Promise<Metadata> {
  const sp = searchParams ? await searchParams : undefined;
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
  return <PubMaxingShell cityId="london" flags={readTrustedHandoffFlags()} />;
}
