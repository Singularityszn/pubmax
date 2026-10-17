import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import DrinkSubtypePricedView, {
  DEFAULT_SOFT_DRINKS_WATER_LAUNCH_IDS,
} from "@/components/drinks/DrinkSubtypePricedView";
import SiteNav from "@/components/nav/SiteNav";
import { firstSearchParam } from "@/lib/cityShare";
import {
  softDrinksWaterLegacyLeafRedirectSubtypeId,
  softDrinksWaterSubtypeIdFromParam,
} from "@/lib/drinkSubtypeObservedPrice";
import { loadSoftDrinksWaterView } from "@/lib/drinkSubtypePricedView.server";

import "@/components/drinks/drinkSubtypePricedView.css";

const WORKING_TITLE = "Soft drinks and water";

type PageProps = {
  // Next hands a repeated key (`?sub=a&sub=b`) over as an array.
  searchParams: Promise<{ sub?: string | string[] }>;
};

export const metadata: Metadata = {
  title: WORKING_TITLE,
  description:
    "Non-alcoholic prices at London pubs: Lucia 🐐 (Coke Zero and Diet Coke), zero-sugar cola and still water, with the poured brand and publisher status beside every listed figure.",
  alternates: { canonical: "/soft-drinks-and-water" },
};

export default async function SoftDrinksAndWaterPage({ searchParams }: PageProps) {
  // The first value wins, as on /login; an array reaching `.trim()` was a 500
  // (review finding PAGE-7).
  const sub = firstSearchParam((await searchParams).sub);
  const legacyRedirect = softDrinksWaterLegacyLeafRedirectSubtypeId(sub);
  if (legacyRedirect) {
    redirect(
      `/soft-drinks-and-water?sub=${encodeURIComponent(legacyRedirect)}`,
      "replace",
    );
  }
  const subtypeId = softDrinksWaterSubtypeIdFromParam(sub);
  const payload = await loadSoftDrinksWaterView(subtypeId);
  if (!payload) notFound();

  return (
    <main id="main" className="softDrinksWaterLanding">
      <SiteNav />
      <DrinkSubtypePricedView
        title={WORKING_TITLE}
        launchSubtypeIds={DEFAULT_SOFT_DRINKS_WATER_LAUNCH_IDS}
        activeSubtypeId={payload.subtypeId}
        rows={payload.rows}
        observedCounts={payload.observedCounts}
        mcdonalds={payload.mcdonalds}
      />
    </main>
  );
}
