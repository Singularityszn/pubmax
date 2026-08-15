import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import DrinkLandingContent, {
  drinkLandingJsonLd,
} from "@/components/drinks/DrinkLandingContent";
import {
  DRINK_LANDING_CATEGORIES,
  buildDrinkLandingModel,
  isDrinkLandingCategory,
  type DrinkLandingModel,
} from "@/lib/drinkLanding";
import { loadGroupedVenues } from "@/lib/venueDataset";

import "@/components/prices/priceLanding.css";

type PageProps = { params: Promise<{ category: string }> };

async function loadModel(category: string): Promise<DrinkLandingModel | null> {
  if (!isDrinkLandingCategory(category)) return null;
  return buildDrinkLandingModel(category, await loadGroupedVenues());
}

export async function generateStaticParams(): Promise<Array<{ category: string }>> {
  return DRINK_LANDING_CATEGORIES.map((category) => ({ category }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category } = await params;
  const model = await loadModel(category);
  if (!model) {
    return {
      title: "Drink prices · PUBMAXXING",
      robots: { index: false, follow: false },
    };
  }
  const title = "Cheapest beer in London · PUBMAXXING";
  const description = `${model.totalPricedVenues} London pubs ranked by their cheapest pint on record, with publisher disclosure for every price.`;
  return {
    title,
    description,
    alternates: { canonical: "/drink/beer" },
    openGraph: {
      title,
      description,
      type: "website",
      url: "/drink/beer",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function DrinkLandingPage({ params }: PageProps) {
  const { category } = await params;
  const model = await loadModel(category);
  if (!model) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <main className="priceLandingPage">
      <JsonLd data={drinkLandingJsonLd(model)} nonce={nonce} />
      <SiteNav active="discover" />
      <DrinkLandingContent model={model} />
    </main>
  );
}
