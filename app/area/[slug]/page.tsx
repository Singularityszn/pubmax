import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import PriceBadge from "@/components/PriceBadge";
import SiteNav from "@/components/nav/SiteNav";
import JsonLd from "@/components/seo/JsonLd";
import {
  loadNightAreaLanding,
  loadNightAreaLandings,
} from "@/lib/nightAreaLanding.server";
import type { NightAreaLanding } from "@/lib/nightAreaLanding";

import "./area.css";

type PageProps = { params: Promise<{ slug: string }> };

const SITE_URL = "https://pubmaxxing.com";
const GBP_FORMATTER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const revalidate = 86_400;
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return (await loadNightAreaLandings()).map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const landing = await loadNightAreaLanding(slug);
  if (!landing) {
    return {
      title: "Area · PUBMAXXING",
      robots: { index: false, follow: false },
    };
  }
  const title = `Cheapest pints in ${landing.name} · PUBMAXXING`;
  const description = `${landing.pricedPubCount} pubs in ${landing.name}, ranked by listed cheapest pint. Prices name and link their publisher.`;
  return {
    title,
    description,
    alternates: { canonical: `/area/${landing.slug}` },
    openGraph: {
      title,
      description,
      type: "website",
      url: `/area/${landing.slug}`,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

function formatCollectedDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(iso));
}

function areaJsonLd(landing: NightAreaLanding) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Map", item: `${SITE_URL}/map` },
        {
          "@type": "ListItem",
          position: 2,
          name: landing.name,
          item: `${SITE_URL}/area/${landing.slug}`,
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Cheapest pints in ${landing.name}`,
      numberOfItems: landing.pricedPubCount,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      itemListElement: landing.prices.map((row) => ({
        "@type": "ListItem",
        position: row.rank,
        name: row.venueName,
        url: `${SITE_URL}/ledger/${row.venueId}`,
      })),
    },
  ];
}

export default async function NightAreaLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const landing = await loadNightAreaLanding(slug);
  if (!landing) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const collected = formatCollectedDate(landing.collectedAt);
  const mapHref = `/map?q=${encodeURIComponent(landing.name)}`;

  return (
    <main id="main" className="areaLanding">
      <JsonLd data={areaJsonLd(landing)} nonce={nonce} />
      <SiteNav />

      <header className="areaLanding__head">
        <p className="areaLanding__eyebrow"><Link href="/map">London map</Link> · {landing.name}</p>
        <h1>Cheapest pints in {landing.name}</h1>
        <p className="areaLanding__summary">
          {landing.pricedPubCount} pubs with listed Pint Prices. Collected {collected}.
        </p>
        <div className="areaLanding__actions">
          <Link className="areaLanding__primary" href={mapHref}>Open {landing.name} on Map</Link>
          <Link className="areaLanding__secondary" href="/plan">Plan a pub crawl</Link>
        </div>
      </header>

      <section className="areaLanding__prices" aria-labelledby="area-price-heading">
        <div className="areaLanding__sectionHead">
          <h2 id="area-price-heading">Pints from cheapest</h2>
          <span>{landing.pricedPubCount} pubs</span>
        </div>
        <div className="areaLanding__tableFrame">
          <table>
            <caption className="srOnly">
              Pubs in {landing.name}, ordered by listed cheapest pint price
            </caption>
            <thead>
              <tr>
                <th scope="col" className="areaLanding__rankHead">#</th>
                <th scope="col">Pub</th>
                <th scope="col" className="areaLanding__priceHead">
                  <span className="areaLanding__priceHeadWide">Cheapest pint</span>
                  <span className="areaLanding__priceHeadNarrow">Pint price</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {landing.prices.map((row) => (
                <tr key={row.venueId}>
                  <th scope="row" className="areaLanding__rank">
                    <span>{row.rank}</span>
                  </th>
                  <td className="areaLanding__pub">
                    <Link href={`/ledger/${row.venueId}`}>{row.venueName}</Link>
                    <span className="areaLanding__pint">{row.pintName || "Pint"}</span>
                    <span className="areaLanding__publisher">
                      Publisher: {row.publisher ? (
                        <a href={row.publisher.url} target="_blank" rel="noopener noreferrer">
                          {row.publisher.name}
                        </a>
                      ) : "not recorded"}
                    </span>
                  </td>
                  <td className="areaLanding__price">
                    <PriceBadge variant="current">{GBP_FORMATTER.format(row.priceGbp)}</PriceBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
