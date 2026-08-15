import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import NightAreaLandingContent, {
  nightAreaLandingJsonLd,
} from "@/components/areas/NightAreaLandingContent";
import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import {
  buildNightAreaLandingModel,
  buildNightAreaLandingModels,
  type NightAreaLandingModel,
} from "@/lib/nightAreaLanding";
import { loadGroupedVenues } from "@/lib/venueDataset";

import "@/components/prices/priceLanding.css";

type PageProps = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

async function loadModel(slug: string): Promise<NightAreaLandingModel | null> {
  return buildNightAreaLandingModel(slug, await loadGroupedVenues());
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return buildNightAreaLandingModels(await loadGroupedVenues()).map((model) => ({
    slug: model.slug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const model = await loadModel(slug);
  if (!model) {
    return {
      title: "Night Area pint prices · PUBMAXXING",
      robots: { index: false, follow: false },
    };
  }
  const title = `Cheapest pints in ${model.name} · PUBMAXXING`;
  const description = `${model.totalPricedVenues} publisher-backed pubs in ${model.name}, ranked by their cheapest pint on record.`;
  const canonical = `/area/${model.slug}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: "website", url: canonical },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function NightAreaLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const model = await loadModel(slug);
  if (!model) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <main className="priceLandingPage">
      <JsonLd data={nightAreaLandingJsonLd(model)} nonce={nonce} />
      <SiteNav />
      <NightAreaLandingContent model={model} />
    </main>
  );
}
