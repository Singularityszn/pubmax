import type { Metadata } from "next";

import ContributorRecord from "@/components/contributors/ContributorRecord";
import SiteNav from "@/components/nav/SiteNav";
import {
  enrichContributorBoard,
  readContributorLeaderboard,
} from "@/lib/contributorLeaderboardStore";

import "./contributors.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Contributor record",
  description:
    "PUBMAXX profiles ranked by their price logs, Visit Reports and Recommendations, over all time.",
  alternates: { canonical: "/contributors" },
};

export default async function ContributorsPage() {
  const board = await enrichContributorBoard(await readContributorLeaderboard());
  return (
    <div className="contributorPage">
      <SiteNav active="profile" />
      <main id="main" className="contributorMain">
        <ContributorRecord board={board} />
      </main>
    </div>
  );
}
