import Link from "next/link";
import { notFound } from "next/navigation";
import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import { paydayStations } from "@/lib/paydayPintData.server";
import { paydayDeliveryReady, paydayFeatureEnabled } from "@/lib/paydayPintFlags.server";
import PaydaySignup from "./PaydaySignup";
import "./payday-pint.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payday pint email", description: "Weekly sourced pint prices near your home station." };
export default async function PaydayPintPage() {
  if (!paydayFeatureEnabled()) notFound();
  const stations = [...new Set((await paydayStations()).map((station) => station.name))].sort((a, b) => a.localeCompare(b));
  return <><SiteNav /><Screen as="main" id="main" className="paydayPage" kicker="Payday pint" title="Pints near your home station." lede="Get a weekly email with sourced pint prices near your station." actionsAfterContent secondary={<Link href="/">Back to home</Link>}><PaydaySignup stations={stations} available={paydayDeliveryReady()} /></Screen></>;
}
