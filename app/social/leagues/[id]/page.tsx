import type { Metadata } from "next";

import LeagueClient from "./LeagueClient";

// A league is private to its members, so there is nothing here for a crawler.
export const metadata: Metadata = {
  title: "League",
  description: "A private league on PUBMAXX, ranked by points.",
  robots: { index: false, follow: false },
};

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const { id } = await params;
  return <LeagueClient id={id} />;
}
