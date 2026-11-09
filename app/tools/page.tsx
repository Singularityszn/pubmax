import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import PubComparisonForm from "@/components/tools/PubComparisonForm";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import "./tools.css";

const title = "Compare pub drink prices and walking routes";
const description = "Compare the same drinks and servings at up to three London pubs. See what is missing, compare the walk and choose with friends.";
export const metadata: Metadata = {
  title, description, alternates: { canonical: "/tools" },
  openGraph: { title: appPageTitle(title), description, url: "/tools", siteName: metadataSiteName(), type: "website", images: ["/og.png?v=20260715-coral"] },
  twitter: { card: "summary_large_image", title: appPageTitle(title), description, images: ["/og.png?v=20260715-coral"] },
};

export default function ToolsPage() {
  return <main id="main" className="pubToolsPage">
    <SiteNav />
    <Screen title="Same order. Which pub?" titleId="pub-tools-title"
      lede="Compare what your group wants, see the walk, then choose together.">
      <PubComparisonForm />
      <section className="pubToolsMethod" aria-labelledby="pub-tools-method">
        <h2 id="pub-tools-method">What the comparison means</h2>
        <p>Each price keeps its named drink, serving, branch, source and read date. A missing price stays missing.</p>
        <p>A complete total needs a listed price for every item. An incomplete order shows only its known subtotal and cannot claim a saving.</p>
        <p>Walking times compare routes from the same public meeting point. If a walking route is unavailable, the price comparison still works.</p>
        <p>Prices do not confirm opening hours, seating or accessibility. Check these requirements with the pub before you go.</p>
        <p>Your private plans and poll answers are not search pages. Shared links open public pub records or the existing invitation.</p>
        <nav aria-label="More ways to choose a pub"><Link href="/borough">Browse London boroughs</Link><Link href="/historic">Read pub history</Link><Link href="/crawls">Choose a pub crawl</Link></nav>
      </section>
    </Screen>
  </main>;
}
