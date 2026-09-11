import type { Metadata } from "next";
import Link from "next/link";

import CityChooser from "@/components/city/CityChooser";
import Screen from "@/components/ui/screen";
import { MAIN_LANDMARK_ID } from "@/lib/a11yLandmarks";
import { cityMapShareUrl, firstSearchParam } from "@/lib/cityShare";
import {
  UK_NATIONAL_ENTRY_LABEL,
  UK_NATIONAL_MAP_HREF,
} from "@/lib/ukNationalBrowse";

type ChooseCityPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

// The canonical moved to /places with the sitemap row, and proxy.ts 308s this
// address there, so nothing in the app links here any more. The route keeps no
// canonical of its own: a canonical on a page that redirects points a crawler
// back at the address it just left.
export const metadata: Metadata = {
  title: "Choose your city",
  description:
    "Pick your PUBMAXXING city map: London, Manchester, Glasgow, and more. Listed pint prices, crawls, and the last way home.",
};

/**
 * The route's head is the launch Screen (docs/design/LAUNCH_SCREENS.md): the
 * flagship city is the one painted action and the national map the quiet way
 * onward. The chooser under it is the same body the landing shares, without a
 * head of its own, so the route prints one heading and one primary.
 */
export default async function ChooseCityPage({
  searchParams,
}: ChooseCityPageProps) {
  const sp = searchParams ? await searchParams : undefined;
  const focusSearch = firstSearchParam(sp?.focus) === "search";
  return (
    <Screen
      as="main"
      id={MAIN_LANDMARK_ID}
      kicker="Places"
      title="Choose your city"
      titleId="choose-city-title"
      primary={<Link href={cityMapShareUrl("london")}>London</Link>}
      secondary={<Link href={UK_NATIONAL_MAP_HREF}>{UK_NATIONAL_ENTRY_LABEL}</Link>}
    >
      <CityChooser variant="body" focusSearch={focusSearch} />
    </Screen>
  );
}
