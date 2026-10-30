import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { buildCityRivalrySnapshot } from "@/lib/cityRivalry";
import { loadHeritageCrawls } from "@/lib/heritageCrawls";
import { parseSocialShellSearch } from "@/lib/socialShell";
import { socialDocumentRobots, socialSurfaceName } from "@/lib/socialLaunch";
import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";

import SocialPageClient from "./SocialPageClient";

const SOCIAL_DESCRIPTION =
  "Pub-night posts in the order they went up, plus public posts about pubs.";

type SearchParams = Record<string, string | string[] | undefined>;

function toUrlSearchParams(input: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  return params;
}

// THE TITLE FOLLOWS THE TAB (launch review, 30 Oct 2026, item 10). `/discover`
// and `/drinks` redirect to `/social?tab=discover`, whose heading reads "Pubs
// and pints", so a tab titled "Social" told a reader and a search result they
// had landed somewhere else. An invalid query redirects to /social in the page,
// so it is titled as /social here.
const SOCIAL_DISCOVER_TITLE = "Pubs and pints";
const SOCIAL_DISCOVER_DESCRIPTION =
  "London pubs and their listed pint prices, plus heritage crawls to walk.";

export async function generateMetadata(
  props: { searchParams: Promise<SearchParams> },
): Promise<Metadata> {
  const friendsLaunchEnabled = readTrustedHandoffFlag("socialFriendsLaunch");
  const state = props.searchParams
    ? parseSocialShellSearch(toUrlSearchParams(await props.searchParams))
    : null;
  const discover = state?.valid === true && state.tab === "discover";
  const surface = discover ? SOCIAL_DISCOVER_TITLE : socialSurfaceName(friendsLaunchEnabled);
  const description = discover ? SOCIAL_DISCOVER_DESCRIPTION : SOCIAL_DESCRIPTION;
  const url = discover ? "/social?tab=discover" : "/social";
  return {
    title: surface,
    description,
    alternates: { canonical: url },
    robots: socialDocumentRobots(friendsLaunchEnabled),
    openGraph: {
      title: appPageTitle(surface),
      description,
      url,
      siteName: metadataSiteName(),
      type: "website",
      images: ["/og.png"],
    },
  };
}

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const state = parseSocialShellSearch(toUrlSearchParams(await searchParams));
  if (!state.valid) redirect("/social");

  const friendsLaunchEnabled = readTrustedHandoffFlag("socialFriendsLaunch");

  const [rivalry, heritageCrawls] =
    friendsLaunchEnabled && state.tab === "discover"
      ? await Promise.all([buildCityRivalrySnapshot(), loadHeritageCrawls()])
      : [[], []];

  return (
    <SocialPageClient
      initialState={state}
      rivalry={rivalry}
      heritageCrawls={heritageCrawls}
      friendsLaunchEnabled={friendsLaunchEnabled}
    />
  );
}
