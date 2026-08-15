import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import DrinkBrandLandingContent from "@/components/drinks/DrinkBrandLandingContent";
import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import {
  drinkBrandLandingJsonLd,
  loadDrinkBrandLanding,
  loadDrinkBrandLandings,
} from "@/lib/drinkBrandLanding.server";

import "./drink.css";

type PageProps = { params: Promise<{ slug: string }> };

export const revalidate = 86_400;
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return (await loadDrinkBrandLandings()).map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const landing = await loadDrinkBrandLanding(slug);

  if (!landing) {
    return {
      title: "Drink · PUBMAXX",
      robots: { index: false, follow: false },
    };
  }

  const title = `Cheapest ${landing.brandLabel} Pints in London · PUBMAXX`;
  const cheapest = landing.rows[0]?.priceGbp;
  const description =
    typeof cheapest === "number"
      ? `${landing.totalPricedVenues} London venues with listed ${landing.brandLabel} pints from £${cheapest.toFixed(2)}.`
      : `Listed ${landing.brandLabel} pint prices across London.`;
  const canonical = `/drink/${encodeURIComponent(landing.slug)}`;

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

export default async function DrinkBrandLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const landing = await loadDrinkBrandLanding(slug);
  if (!landing) notFound();

  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <main id="main" className="drinkBrandLanding">
      <JsonLd data={drinkBrandLandingJsonLd(landing)} nonce={nonce} />
      <SiteNav />
      <DrinkBrandLandingContent landing={landing} />
    </main>
  );
}
