import type { Metadata } from "next";

import MatesBoardClient from "./MatesBoardClient";

// A per-reader board of the reader and their mates, so there is nothing here
// for a crawler.
export const metadata: Metadata = {
  title: "You and your mates",
  description: "You and your mates on PUBMAXX, ranked by points this month and all time.",
  robots: { index: false, follow: false },
};

export default function MatesBoardPage(): React.JSX.Element {
  return <MatesBoardClient />;
}
