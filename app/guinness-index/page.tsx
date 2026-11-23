import type { Metadata } from "next";
import PriceSourceName from "@/components/venue/PriceSourceName";
import Link from "next/link";
import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import { formatObservedDate } from "@/lib/dataFreshness";
import { loadGuinnessIndex } from "@/lib/guinnessIndex.server";
import { formatPrice } from "@/lib/venues";
import "@/components/drinks/drinkBrandDirectory.css";
import "./style.css";

export const metadata: Metadata = {
  title: "London Guinness index",
  description: "Compare listed Guinness pint prices across London boroughs.",
  alternates: { canonical: "/guinness-index" },
  openGraph: { title: "London Guinness index", description: "Compare listed Guinness pint prices across London boroughs.", url: "/guinness-index", type: "website" },
  twitter: { card: "summary_large_image" },
};

function date(day: string) { return formatObservedDate(new Date(`${day}T00:00:00Z`)); }
function evidence(value: { sources: string[]; oldest: string | null; newest: string | null }) {
  if (!value.oldest || !value.newest) return "";
  const period = value.oldest === value.newest ? date(value.oldest) : `${date(value.oldest)} to ${date(value.newest)}`;
  return `${value.sources.join(", ")} · ${period}`;
}

export default async function GuinnessIndexPage() {
  const index = await loadGuinnessIndex();
  return <main id="main" className="drinkBrandLanding"><SiteNav /><div className="drinkBrandDirectory"><Screen as="section" className="drinkBrandDirectory__screen" kicker="Guinness index" title="London Guinness prices" lede={index.medianGbp === null ? "Not enough listed prices yet." : `Median listed pint: ${formatPrice(index.medianGbp)}`} primary={<Link href="/drink/guinness">See listed Guinness pints</Link>}>
    <p>Based on {index.count} venues in our price list with a sourced, dated pint price. These are listed prices and may have changed.</p>
    {index.count > 0 && <p className="guinnessIndex__evidence">Median sources and dates: {evidence(index)}</p>}
    <section className="guinnessIndex__section"><h2>Cheapest and dearest listed</h2><div className="guinnessIndex__extremes">{[index.cheapest, index.dearest].map((row, i) => row && <article key={i}><h3>{i === 0 ? "Cheapest" : "Dearest"}</h3><strong>{formatPrice(row.priceGbp)}</strong><p>{row.venueName}, {row.borough}</p><p><PriceSourceName label={row.publisher.label} url={row.publisher.url} /> · {date(row.observedAt.slice(0, 10))}</p></article>)}</div></section>
    <section className="guinnessIndex__section"><h2>By borough</h2><p>We show a median when at least 10 venues have a price.</p><ul className="guinnessIndex__list">{index.boroughs.map((area) => <li key={area.name}><div><h3>{area.name}</h3><p>{area.count} {area.count === 1 ? "venue" : "venues"}{area.medianGbp === null ? " · Too few prices for a median" : ` · ${evidence(area)}`}</p></div>{area.medianGbp !== null && <strong>{formatPrice(area.medianGbp)}</strong>}</li>)}</ul></section>
  </Screen></div></main>;
}
