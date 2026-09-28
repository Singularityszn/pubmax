import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import DrinkSubtypePricedView, {
  DEFAULT_SOFT_DRINKS_WATER_LAUNCH_IDS,
} from "@/components/drinks/DrinkSubtypePricedView";
import SiteNav from "@/components/nav/SiteNav";
import {
  softDrinksWaterLegacyLeafRedirectSubtypeId,
  softDrinksWaterSubtypeIdFromParam,
} from "@/lib/drinkSubtypeObservedPrice";
import { loadSoftDrinksWaterView } from "@/lib/drinkSubtypePricedView.server";

import "@/components/drinks/drinkSubtypePricedView.css";

const WORKING_TITLE = "Soft drinks and water";

type PageProps = {
  searchParams: Promise<{ sub?: string }>;
};

export const metadata: Metadata = {
  title: WORKING_TITLE,
  description:
    "Zero-sugar cola (Coke Zero, Diet Coke, Pepsi Max, Diet Pepsi) and still water prices at London pubs, with the poured brand and publisher status beside every listed figure.",
  alternates: { canonical: "/soft-drinks-and-water" },
};

export default async function SoftDrinksAndWaterPage({ searchParams }: PageProps) {
  const { sub } = await searchParams;
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
      />
    </main>
  );
}
