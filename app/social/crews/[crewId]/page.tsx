import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isCrewId } from "@/lib/socialCrewsUi";

import CrewDetailClient from "./CrewDetailClient";

// A crew is private to the people on the night and to mates of its host, so the
// page carries no crew content in its metadata and never asks a search engine
// to keep it. The read itself happens in the browser against the authenticated
// crew route, which is the only thing that knows who is asking.
export const metadata: Metadata = {
  title: "Crew",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CrewPage({
  params,
  searchParams,
}: {
  params: Promise<{ crewId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { crewId } = await params;
  if (!isCrewId(crewId)) notFound();
  const search = await searchParams;
  const raw = Array.isArray(search.invitation)
    ? search.invitation[0]
    : search.invitation;
  const invitationId = isCrewId(raw) ? raw : null;

  return <CrewDetailClient crewId={crewId} invitationId={invitationId} />;
}
