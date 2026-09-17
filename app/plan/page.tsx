import type { Metadata } from "next";

import PlanComposer from "@/components/plan/PlanComposer";
import SiteNav from "@/components/nav/SiteNav";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";

import planStyles from "./Plan.module.css";

const PAGE_TITLE = "Sort the outing";
const PAGE_DESCRIPTION =
  "Put the pubs in order, pick a time, and send one link to the crew.";
/** The site card. There is no per-plan card until a plan exists. */
const SITE_CARD = "/og.png?v=20260715-coral";

// WHAT A CRAWLER AND AN UNFURLER GET FROM THE BLANK COMPOSER.
//
// Astra F09 (6 Sep 2026): this route carried no metadata of its own beyond a
// title, so it inherited the ROOT layout's Open Graph block whole. Every share
// of /plan unfurled as the homepage: og:url https://pubmaxxing.com, the
// site-wide title and the site-wide description, over a page that is the
// planner. It was also indexable, and there is nothing here to index.
//
// THREE decisions, and each is its own question.
//
// 1. NOINDEX, FOLLOW. The document is an empty composer. What fills it is the
//    reader's own draft, built in the browser after load, so a crawler is
//    served a form with no answer in it. Following stays on, because /plan
//    links onward to the map and the pubs, which ARE the indexable content.
//
// 2. IT STILL CARRIES A CANONICAL, which /out and /places deliberately do not.
//    Their reason was that ANOTHER indexable family already publishes the same
//    content, so a second canonical would compete for it. Nothing else owns
//    /plan. What a canonical does here is collapse the shareable handoff
//    variants (?query=, ?occasion=, ?describe=, ?from=) onto one address, and
//    a canonical is not an indexing instruction. /near carries the same pair
//    for the same reason.
//
// 3. THE OPEN GRAPH BLOCK IS THE ROUTE'S OWN, because an unfurler reads `og:`
//    and ignores robots, so a shared planner link has to say what the planner
//    is. The image stays the site card: there is no per-plan card until a plan
//    exists, and app/plan/[id] owns that one.
export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  robots: {
    index: false,
    follow: true,
    googleBot: { index: false, follow: true },
  },
  alternates: { canonical: "/plan" },
  openGraph: {
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    url: "/plan",
    siteName: metadataSiteName(),
    type: "website",
    // Next does not merge the root layout's images into a route that declares
    // its own `openGraph`, so the site card is named here or a shared planner
    // link unfurls with no picture at all.
    images: [SITE_CARD],
  },
  twitter: {
    card: "summary_large_image",
    title: appPageTitle(PAGE_TITLE),
    description: PAGE_DESCRIPTION,
    images: [SITE_CARD],
  },
};

export default function NewPlanPage() {
  return (
    <main id="main" className={`${planStyles.planPage} planPage--composer`}>
      {/* Standard site navigation: /plan is a shared-link surface and must
          never be a dead end. The route's head (kicker, h1, the one primary
          action) is the describe-first Screen inside PlanComposer, so nothing
          is printed twice here. */}
      <SiteNav />
      <PlanComposer />
    </main>
  );
}
