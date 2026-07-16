import type { Metadata } from "next";

import PubsGallery from "@/components/pubs/PubsGallery";
import SiteNav from "@/components/nav/SiteNav";
import { listScrapedPubs } from "@/lib/scrapedPubs.server";

import "@/components/pubs/pubsGallery.css";

export const metadata: Metadata = {
  title: "Pubs — scraped menus on the map · PUBMAXXING",
  description:
    "Browse Young's, Nicholson's, and Greene King pubs we've scraped — each with a drink picture, menu links, and a jump to the map.",
  alternates: { canonical: "/pubs" },
};

export default async function PubsPage() {
  const pubs = await listScrapedPubs();

  return (
    <main className="pubsShell">
      <SiteNav active="pubs" />
      <div className="pubsPage">
        <header className="pubsHead">
          <p className="pubsEyebrow">Scraped pubs</p>
          <h1>Pubs with a drink on every card</h1>
          <p className="pubsDek">
            Young&apos;s gardens, Nicholson&apos;s historic rooms, and Greene King
            menus we&apos;ve scraped into the London map — open a pub, check the
            menu, or jump straight onto the pin.
          </p>
        </header>
        <PubsGallery pubs={pubs} />
      </div>
    </main>
  );
}
