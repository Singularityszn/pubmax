"use client";

import SiteNav from "@/components/nav/SiteNav";
import DrinkWall from "@/components/drink-wall/DrinkWall";

export default function WallClient() {
  return (
    <main className="wallPage">
      <SiteNav />
      <div className="wallPageBody">
        <DrinkWall />
      </div>
    </main>
  );
}
