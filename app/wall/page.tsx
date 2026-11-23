import type { Metadata } from "next";

import DrinkWall from "@/components/drink-wall/DrinkWall";
import SiteNav from "@/components/nav/SiteNav";
import "@/components/listing/listing.css";

export const metadata: Metadata = {
  title: "Photos from drinkers",
  description: "Pints, pub fronts and London views from drinkers on PUBMAXX.",
  alternates: { canonical: "/wall" },
};

export default function WallPage() {
  return (
    <main id="main" className="wallPage listingShell">
      <SiteNav />
      <div className="wallPageBody listingSection">
        <DrinkWall />
      </div>
    </main>
  );
}
