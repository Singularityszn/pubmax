import type { Metadata, Route } from "next";
import Link from "next/link";
import SiteNav from "@/components/nav/SiteNav";
import { RowList, RowListItem } from "@/components/ui/row-list";
import BoroughScreen from "@/app/borough/BoroughScreen";
import { stations, stationSlug } from "@/lib/stationPages";
import "@/components/listing/listing.css";
import "@/app/borough/[slug]/borough.css";

export const metadata: Metadata = {
  title: "Pubs near London stations",
  description: "Find pubs and pint prices near London Tube, Overground, Elizabeth line and DLR stations.",
  alternates: { canonical: "/stations" },
};

export default function StationsPage() {
  return <main id="main" className="boroughPage listingShell">
    <SiteNav active="borough" />
    <BoroughScreen kicker="London stations" title="Find a pint near your station" titleId="stationsHeading" lede="Choose a station for nearby pubs and their recorded pint prices." mapHref="/map" mapLabel="Open the map">
      <p>Includes Tube, Overground, Elizabeth line and DLR stations in the London fare zones. Station data: Powered by TfL Open Data. Contains OS data © Crown copyright and database rights.</p>
      <RowList label="London stations" className="boroughRows listingRead">
        {stations.map((station) => <RowListItem key={station.name} href={`/stations/${stationSlug(station.name)}` as Route} title={station.name} meta={`Zone ${station.zone}`} />)}
      </RowList>
      <Link href="/borough">Browse by borough</Link>
    </BoroughScreen>
  </main>;
}
