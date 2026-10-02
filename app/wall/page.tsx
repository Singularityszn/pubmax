import type { Metadata } from "next";

import DrinkWall from "@/components/drink-wall/DrinkWall";
import SiteNav from "@/components/nav/SiteNav";

export const metadata: Metadata = {
  title: "Drink Wall · PUBMAXXING",
  description: "Pints, pub fronts and London views from drinkers on PubMaxxing.",
  alternates: { canonical: "/wall" },
};

export default function WallPage() {
  return (
    <main className="wallPage">
      <SiteNav />
      <div className="wallPageBody">
        <DrinkWall />
      </div>
    </main>
  );
}
