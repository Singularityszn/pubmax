import type { Metadata } from "next";

import LeaguesClient from "./LeaguesClient";

// A per-reader list of private leagues, so there is nothing here for a crawler.
export const metadata: Metadata = {
  title: "Your leagues",
  description: "Private leagues on PUBMAXX: you and the people you invite, ranked by points.",
  robots: { index: false, follow: false },
};

export default function LeaguesPage(): React.JSX.Element {
  return <LeaguesClient />;
}
