import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/components/nav/SiteNav";
import BoroughScreen from "@/app/borough/BoroughScreen";
import StationList from "./StationList";
import { stations, stationSlug } from "@/lib/stationPages";
import "./stations.css";
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
      <StationList stations={stations.map(({ name, zone }) => ({ name, zone, slug: stationSlug(name) }))} />
      <Link href="/borough" className="listingLink">Browse by borough</Link>
    </BoroughScreen>
  </main>;
}
