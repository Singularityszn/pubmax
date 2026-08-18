import type { Metadata } from "next";
import Link from "next/link";

import PubsGallery from "@/components/pubs/PubsGallery";
import SiteNav from "@/components/nav/SiteNav";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { readScrapedPubsForPage } from "@/lib/scrapedPubs.server";

import "@/components/pubs/pubsGallery.css";

const CHAINS_DESCRIPTION =
  "Chain pub menus we have checked: Young's, Nicholson's, and Greene King. Each card links to the map pin.";

function chainsHeading(count: number | null): string {
  if (count === null) return "Chains";
  return `Chains (${count} chain pubs)`;
}

export async function generateMetadata(): Promise<Metadata> {
  const { pubs, complete } = await readScrapedPubsForPage();
  const count = complete ? pubs.length : null;
  const pageTitle = chainsHeading(count);
  return {
    title: pageTitle,
    description: CHAINS_DESCRIPTION,
    alternates: { canonical: "/pubs" },
    openGraph: {
      title: appPageTitle(pageTitle),
      description: CHAINS_DESCRIPTION,
      url: "/pubs",
      siteName: metadataSiteName(),
      type: "website",
      images: ["/og.png"],
    },
  };
}

export default async function PubsPage() {
  const { pubs, complete } = await readScrapedPubsForPage();
  const count = complete ? pubs.length : null;

  return (
    <main id="main" className="pubsShell">
      <SiteNav active="pubs" />
      <div className="pubsPage">
        <header className="pubsHead">
          <p className="pubsEyebrow">On the map</p>
          <h1>{chainsHeading(count)}</h1>
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
