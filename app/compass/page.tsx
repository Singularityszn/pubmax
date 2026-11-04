import type { Metadata } from "next";

import PintCompass from "@/components/compass/PintCompass";

// The Pint Compass: a needle that points at the cheapest listed pint inside a
// short walk. noindex, like /near: the answer depends on where the reader
// stands, and the borough pages carry the crawlable price content. The page
// is a client shell. The location and the heading are read in the browser
// after a tap and sent nowhere (components/compass/useCompassSensors.ts).
export const metadata: Metadata = {
  title: "Pint compass",
  description:
    "A needle that points at the cheapest listed pint within a short walk. Uses your location and your phone's compass.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/compass" },
};

export default function CompassPage() {
  return <PintCompass />;
}
