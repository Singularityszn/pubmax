import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteNav from "@/components/nav/SiteNav";
import { RowList, RowListItem } from "@/components/ui/row-list";
import ListedPriceSource from "@/components/venue/ListedPriceSource";
import BoroughScreen from "@/app/borough/BoroughScreen";
import { loadPintPriceLandingVenuesOrThrow } from "@/lib/pintPriceLandingDataset.server";
import { nearbyStationPubs, stationFromSlug } from "@/lib/stationPages";
import { venuePriceEvidence } from "@/lib/venuePriceEvidence";
import { formatPrice } from "@/lib/venues";
import { walkMinutesFromKm } from "@/lib/walkMinutes";
import "@/components/listing/listing.css";
import "@/app/borough/[slug]/borough.css";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const station = stationFromSlug(slug);
  if (!station) return { title: "Station not found" };
  return {
    title: `Pubs near ${station.name} station and pint prices`,
    description: `Find nearby pubs and recorded pint prices near ${station.name} station in London.`,
    alternates: { canonical: `/stations/${slug}` },
  };
}

export default async function StationPage({ params }: Props) {
  const { slug } = await params;
  const station = stationFromSlug(slug);
  if (!station) notFound();
  const pubs = nearbyStationPubs(station, await loadPintPriceLandingVenuesOrThrow());
  return <main id="main" className="boroughPage listingShell">
    <SiteNav active="borough" />
    <BoroughScreen kicker={`London · Zone ${station.zone}`} title={`Pubs near ${station.name} station`} titleId="stationHeading" lede="Recorded pint prices, cheapest first. Pubs are within 1 km in a straight line." mapHref="/map" mapLabel="Open the map">
      <p>Walking distances follow streets where mapped. Other distances and walking times are straight-line estimates and the real walk may be longer.</p>
      <Link href="/stations" className="listingLink">All stations</Link>
      {pubs.length === 0 ? <p>No pubs in our price dataset are recorded within 1 km of this station yet.</p> :
        <RowList label={`Pubs near ${station.name}`} className="boroughRows listingRead">
          {pubs.map(({ venue, price, distanceMetres, street }) => {
            const evidence = price === null ? null : venuePriceEvidence(venue, price, true);
            const distance = Math.round(distanceMetres / 10) * 10;
            const minutes = walkMinutesFromKm(distanceMetres / 1000);
            return <RowListItem key={venue.id} href={`/pubs/${encodeURIComponent(venue.id)}#ledger` as Route} title={venue.name}
              meta={`${distance} m ${street ? "estimated walk" : "straight line"} · about ${minutes} min${street ? " on foot" : " (straight-line estimate)"}`}
              detail={evidence ? <><p>{evidence.drinkLabel ?? "Drink not recorded"} · {evidence.servingSize ?? "Serving not recorded"}</p><ListedPriceSource evidence={evidence} kind={evidence.sourceKind} /></> : undefined}
              trailing={price === null ? "No comparable pint price" : formatPrice(price)} />;
          })}
        </RowList>}
      <p>Station data: Powered by TfL Open Data. Contains OS data © Crown copyright and database rights.</p>
    </BoroughScreen>
  </main>;
}
