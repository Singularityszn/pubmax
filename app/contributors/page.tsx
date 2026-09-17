import type { Metadata } from "next";

import ContributorRecord from "@/components/contributors/ContributorRecord";
import SiteNav from "@/components/nav/SiteNav";
import {
  enrichContributorBoard,
  readContributorLeaderboard,
} from "@/lib/contributorLeaderboardStore";

import styles from "./Contributors.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Contributor record",
  description:
    "Existing PUBMAXX profiles ranked by identity-backed visible price logs, Visit Reports and weather Recommendations.",
  alternates: { canonical: "/contributors" },
};

export default async function ContributorsPage() {
  const board = await enrichContributorBoard(await readContributorLeaderboard());
  return (
    <div className={styles.contributorPage}>
      <SiteNav active="profile" />
      <main id="main" className={styles.contributorMain}>
        <ContributorRecord board={board} />
      </main>
    </div>
  );
}
