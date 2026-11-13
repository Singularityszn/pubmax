import type { Metadata } from "next";

import JoinLeagueClient from "./JoinLeagueClient";

// An invite link. The code is the invite, so a crawler must never keep one.
export const metadata: Metadata = {
  title: "Join a league",
  description: "Someone invited you to their league on PUBMAXX.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function JoinLeaguePage({ params }: { params: Promise<{ code: string }> }): Promise<React.JSX.Element> {
  const { code } = await params;
  return <JoinLeagueClient code={code} />;
}
