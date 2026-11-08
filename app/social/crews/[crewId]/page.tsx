import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isCrewId } from "@/lib/socialCrewsUi";
import { loadOpenCrawlShareCard } from "@/lib/openCrawlShareCard.server";
import {
  openCrawlShareDescription,
  openCrawlShareTitle,
} from "@/lib/openCrawlShareCard";

import PublicCrewRouteClient from "@/components/social/PublicCrewRouteClient";

// Invite and Crew routes stay noindex. Open Crews may show a narrow public
// preview without an account, while member data and every write remain behind
// the verified Social actor route.
const CREW_ROBOTS = { index: false, follow: false } as const;

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  params: Promise<{ crewId: string }>;
  searchParams: Promise<SearchParams>;
};

// A host posts an open crawl's link on Luma and X (launch plan P0 item 4), so
// the link unfurls with what a stranger needs to decide: the host's public
// handle, the day and time, the area, the meeting pub, the places left and
// the pint price band. A crew that is not open, or a read that cannot run,
// keeps the plain "Crew" title and names nothing. opengraph-image.tsx sits
// beside this route, so Next attaches the card image.
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { crewId } = await params;
  const plain: Metadata = { title: "Crew", robots: CREW_ROBOTS };
  if (!isCrewId(crewId)) return plain;
  const result = await loadOpenCrawlShareCard(crewId);
  if (!result.ok) return plain;
  const title = openCrawlShareTitle(result.card);
  const description = openCrawlShareDescription(result.card);
  return {
    title,
    description,
    robots: CREW_ROBOTS,
    openGraph: {
      title,
      description,
      type: "website",
      url: `/social/crews/${crewId}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function CrewPage({ params, searchParams }: PageProps) {
  const { crewId } = await params;
  if (!isCrewId(crewId)) notFound();
  const search = await searchParams;
  const raw = Array.isArray(search.invitation)
    ? search.invitation[0]
    : search.invitation;
  const invitationId = isCrewId(raw) ? raw : null;

  return <PublicCrewRouteClient key={crewId} crewId={crewId} invitationId={invitationId} />;
}
