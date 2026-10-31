import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/nav/SiteNav";
import Kicker from "@/components/ui/kicker";
import { appPageTitle, metadataSiteName } from "@/lib/brandNaming";
import { PUBLIC_UPDATES } from "@/lib/publicUpdates";

import "../legal.css";

const DESCRIPTION = "The latest changes now live on PUBMAXX, newest first.";
const releaseDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export const metadata: Metadata = {
  title: "Updates",
  description: DESCRIPTION,
  alternates: { canonical: "/updates" },
  openGraph: {
    title: appPageTitle("Updates"),
    description: DESCRIPTION,
    url: "https://pubmaxxing.com/updates",
    siteName: metadataSiteName(),
    type: "website",
  },
};

export default function UpdatesPage() {
  const updates = PUBLIC_UPDATES.toSorted((left, right) => right.date.localeCompare(left.date));

  return (
    <>
      <SiteNav />
      <main id="main" className="legalPage">
        <header className="legalHead">
          <Kicker>Updates</Kicker>
          <h1 className="legalTitle">What&apos;s changed</h1>
          <p className="legalLede">{DESCRIPTION}</p>
        </header>
        <section aria-label="Product updates">
          {updates.map((update) => (
            <article
              key={update.id}
              className="legalSection"
              aria-labelledby={update.id}
            >
              <p className="legalUpdated">
                <time dateTime={update.date}>
                  {releaseDate.format(new Date(`${update.date}T00:00:00Z`))}
                </time>
              </p>
              <h2 id={update.id} className="legalH2">{update.title}</h2>
              <ul className="legalList">
                {update.changes.map((change) => <li key={change}>{change}</li>)}
              </ul>
            </article>
          ))}
        </section>
        <p className="legalBody">
          <Link href="/map" prefetch={false} className="legalLink">Open the map</Link>
        </p>
      </main>
    </>
  );
}
