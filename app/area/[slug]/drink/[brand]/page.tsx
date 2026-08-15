import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import DrinkBrandAreaLandingContent from "@/components/drinks/DrinkBrandAreaLandingContent";
import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import { formatDrinkBrandLandingPublisherStatus } from "@/lib/drinkBrandLanding";
import {
  drinkBrandAreaLandingJsonLd,
  loadDrinkBrandAreaLanding,
  loadDrinkBrandAreaLandings,
} from "@/lib/drinkBrandAreaLanding.server";
import { formatPrice } from "@/lib/venues";

import "./drink-area.css";

type PageProps = {
  params: Promise<{ slug: string; brand: string }>;
};

export const revalidate = 86_400;
export const dynamicParams = false;

export async function generateStaticParams(): Promise<
  Array<{ slug: string; brand: string }>
> {
  return (await loadDrinkBrandAreaLandings()).map(({ areaSlug, brandSlug }) => ({
    slug: areaSlug,
    brand: brandSlug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, brand } = await params;
  const landing = await loadDrinkBrandAreaLanding(slug, brand);

  if (!landing) {
    return {
      title: "Drink by area · PUBMAXX",
      robots: { index: false, follow: false },
    };
  }

  const firstRow = landing.rows[0];
  const title = `Cheapest ${landing.brandLabel} pints in ${landing.areaName}`;
  const description = `${landing.totalPricedVenues} ${landing.areaName} venues with listed ${landing.brandLabel} pints from ${formatPrice(firstRow.priceGbp)}. ${formatDrinkBrandLandingPublisherStatus(firstRow.publisher)}.`;
  const canonical = `/area/${encodeURIComponent(landing.areaSlug)}/drink/${encodeURIComponent(landing.brandSlug)}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function DrinkBrandAreaLandingPage({
  params,
}: PageProps) {
  const { slug, brand } = await params;
  const landing = await loadDrinkBrandAreaLanding(slug, brand);
  if (!landing) notFound();

  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <main id="main" className="drinkBrandAreaLanding">
      <JsonLd data={drinkBrandAreaLandingJsonLd(landing)} nonce={nonce} />
      <SiteNav />
      <DrinkBrandAreaLandingContent landing={landing} />
    </main>
  );
}
