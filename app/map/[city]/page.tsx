import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import PubMaxingShell from "@/components/PubMaxingShell";
import JsonLd from "@/components/seo/JsonLd";
import FactBlock from "@/components/seo/FactBlock";
import FaqBlock from "@/components/seo/FaqBlock";
import { getCity, parseCityId, type CityConfig } from "@/lib/cities";
import { pintFactStats, faqItems, faqPageJsonLd } from "@/lib/pintFacts";
import {
  dataFileModified,
  formatMonthYear,
  formatObservedDate,
  PINT_DATASET_FILE,
} from "@/lib/dataFreshness";

import "@/components/seo/factLayer.css";
import {
  cityMapOgAlt,
  cityMapOgDescription,
  cityMapOgImageUrl,
  cityMapOgTitle,
  cityMapShareUrl,
  firstSearchParam,
  stopCountFromPubsParam,
} from "@/lib/cityShare";

type CityMapPageProps = {
  params: Promise<{ city: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
  searchParams,
}: CityMapPageProps): Promise<Metadata> {
  const { city: raw } = await params;
  const cityId = parseCityId(raw);
  if (!cityId) {
    return { title: "City map", robots: { index: false, follow: false } };
  }

  const city = getCity(cityId);
  if (!city.enabled) {
    return { title: "City map", robots: { index: false, follow: false } };
  }

  const sp = searchParams ? await searchParams : undefined;
  const band = firstSearchParam(sp?.band);
  const crawl = firstSearchParam(sp?.crawl);
  const stopCount = stopCountFromPubsParam(firstSearchParam(sp?.pubs));
  const opts = { band, crawl, stopCount };
  const title = cityMapOgTitle(cityId, opts);
  const description = cityMapOgDescription(cityId, opts);
  const url = cityMapShareUrl(cityId, opts);
  const image = cityMapOgImageUrl(cityId, opts);
  const alt = cityMapOgAlt(cityId, opts);

  return {
    title,
    description,
    // Canonical is the bare city map (London → /map), never the share URL with
    // its crawl/band query — those are one crawlable map surface per city.
    alternates: { canonical: cityId === "london" ? "/map" : `/map/${cityId}` },
    openGraph: {
      title,
      description,
      type: "website",
      url,
      images: [{ url: image, width: 1200, height: 630, alt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

// Read a city's slim venue pack server-side, projecting to the minimal shape the
// fact-block stats need (name + per-pub cheapest pint). Never throws: a missing
// or malformed pack yields [], so the fact section renders nothing rather than
// 500-ing. The slim pack currently carries prices for London only; other cities'
// packs ship price-less, so their fact block honestly renders nothing until
// their prices land — no invented figures.
async function loadCityPricedPubs(
  city: CityConfig,
): Promise<{ name: string; cheapestPrice: number | null }[]> {
  try {
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const rel = city.slimVenuesPath.replace(/^\/+/, "");
    const file = path.join(process.cwd(), "public", rel);
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row): row is { name: string; cheapestPrice: number | null } => {
        return (
          typeof row === "object" &&
          row !== null &&
          typeof (row as { name?: unknown }).name === "string"
        );
      })
      .map((row) => ({
        name: row.name,
        cheapestPrice:
          typeof row.cheapestPrice === "number" ? row.cheapestPrice : null,
      }));
  } catch {
    return [];
  }
}

export default async function CityMapPage({ params }: CityMapPageProps) {
  const { city: raw } = await params;
  const cityId = parseCityId(raw);
  if (!cityId) notFound();

  const city = getCity(cityId);
  if (!city.enabled) notFound();

  // Programmatic fact layer (Wave S3.1/S3.2) for the city, below the map shell.
  const pubs = await loadCityPricedPubs(city);
  const observedAt = await dataFileModified(PINT_DATASET_FILE);
  const stats = pintFactStats(pubs, city.displayName, cityId);
  const faq = faqItems(stats, {
    monthYear: formatMonthYear(observedAt),
    year: String(observedAt.getFullYear()),
    observedDate: formatObservedDate(observedAt),
  });
  const faqLd = faqPageJsonLd(faq);
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const hasFacts = faq.length > 0;

  return (
    <>
      <PubMaxingShell cityId={cityId} />
      {hasFacts ? (
        <section className="cityFactRegion">
          {faqLd ? <JsonLd data={faqLd} nonce={nonce} /> : null}
          <FactBlock
            stats={stats}
            monthYear={formatMonthYear(observedAt)}
            observedDate={formatObservedDate(observedAt)}
            headingId="cityFactHeading"
            title={`Pint prices in ${city.displayName}, by the numbers`}
          />
          <FaqBlock
            items={faq}
            headingId="cityFaqHeading"
            title={`Pint prices in ${city.displayName} — questions`}
          />
          <nav className="factLinks" aria-labelledby="cityLinksHeading">
            <p className="factLinksTitle" id="cityLinksHeading">
              Explore more
            </p>
            <ul className="factLinksList">
              <li>
                <Link href="/pint-index">London Pint Index</Link>
              </li>
              <li>
                <Link href="/borough">London boroughs</Link>
              </li>
              <li>
                <Link href="/historic">Historic pubs</Link>
              </li>
            </ul>
          </nav>
        </section>
      ) : null}
    </>
  );
}
