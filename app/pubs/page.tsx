import type { Metadata } from "next";
import Link from "next/link";

import PubsGallery from "@/components/pubs/PubsGallery";
import SiteNav from "@/components/nav/SiteNav";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { listScrapedPubs } from "@/lib/scrapedPubs.server";

import "@/components/pubs/pubsGallery.css";

const CHAINS_DESCRIPTION =
  "Chain pub menus we have checked: Young's, Nicholson's, and Greene King. Each card links to the map pin.";

export async function generateMetadata(): Promise<Metadata> {
  const pubs = await listScrapedPubs();
  const count = pubs.length;
  const pageTitle = `Chains (${count} chain pubs)`;
  const title = appPageTitle(pageTitle);
  return {
    title,
    description: CHAINS_DESCRIPTION,
    alternates: { canonical: "/pubs" },
    openGraph: {
      title,
      description: CHAINS_DESCRIPTION,
      url: "/pubs",
      siteName: metadataSiteName(),
      type: "website",
      images: ["/og.png"],
    },
  };
}

export default async function PubsPage() {
  const pubs = await listScrapedPubs();
  const count = pubs.length;

  return (
    <main id="main" className="pubsShell">
      <SiteNav active="pubs" />
      <div className="pubsPage">
        <header className="pubsHead">
          <p className="pubsEyebrow">On the map</p>
          <h1>Chains ({count} chain pubs)</h1>
          <p className="pubsDek">
            Young&apos;s gardens, Nicholson&apos;s historic rooms, and Greene King
            menus we&apos;ve pulled onto the London map. Open a pub, check the
            menu, or jump straight onto the pin.
          </p>
          <p className="pubsDek">
            <Link href="/map">Browse every listed pub on the map</Link> for the
            full priced set.
          </p>
        </header>
        <PubsGallery pubs={pubs} />
      </div>
    </main>
  );
}
