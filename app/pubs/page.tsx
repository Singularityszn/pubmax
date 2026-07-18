import type { Metadata } from "next";

import PubsGallery from "@/components/pubs/PubsGallery";
import SiteNav from "@/components/nav/SiteNav";
import { listScrapedPubs } from "@/lib/scrapedPubs.server";

import "@/components/pubs/pubsGallery.css";

const PUBS_TITLE = "Pubs: scraped menus on the map · PUBMAXXING";
const PUBS_DESCRIPTION =
  "Browse Young's, Nicholson's, and Greene King pubs we've scraped, each with a drink picture, menu links, and a jump to the map.";

export const metadata: Metadata = {
  title: PUBS_TITLE,
  description: PUBS_DESCRIPTION,
  alternates: { canonical: "/pubs" },
  // Route-specific Open Graph so a shared /pubs link shows this page (not the
  // homepage OG the root layout would otherwise supply). siteName + the shared
  // /og.png card are carried over — this route has no file-convention OG image.
  openGraph: {
    title: PUBS_TITLE,
    description: PUBS_DESCRIPTION,
    url: "/pubs",
    siteName: "PUBMAXXING",
    type: "website",
    images: ["/og.png"],
  },
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
            menus we&apos;ve scraped into the London map. Open a pub, check the
            menu, or jump straight onto the pin.
          </p>
        </header>
        <PubsGallery pubs={pubs} />
      </div>
    </main>
  );
}
