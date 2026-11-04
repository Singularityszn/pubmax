import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Kicker from "@/components/ui/kicker";
import SiteNav from "@/components/nav/SiteNav";
import { readTopTenCard } from "@/lib/passportTopTenCard.server";
import { priceBandClass, priceBandLabel } from "@/lib/priceBand";
import { topTenTitle } from "@/lib/profilePassport";
import { venueMapUrl } from "@/lib/venueMapUrl";

import "@/components/profile/passportBook.css";

// A shared top ten. The link exists only because the owner tapped "Share your
// top ten"; the page renders the signed list from that tap and never reads the
// live ranking (lib/passportTopTenShare.server.ts). It is kept out of search:
// a person's list is theirs to hand round, not ours to index.

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ handle: string; token: string }> };

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { handle, token } = await params;
  const card = await readTopTenCard(handle, decode(token));
  const title = card ? topTenTitle(card.handle) : "Top ten";
  return {
    title,
    robots: { index: false, follow: false },
    openGraph: { title, type: "article", siteName: "PUBMAXX" },
    twitter: { card: "summary_large_image", title },
  };
}

export default async function TopTenPage({ params }: PageProps) {
  const { handle, token } = await params;
  const card = await readTopTenCard(handle, decode(token));
  if (!card) notFound();

  return (
    <div className="lp profilePage">
      <SiteNav active="profile" />
      <main id="main" className="container profileMain">
        <section className="passportTopTen" aria-labelledby="top-ten-title">
          <Kicker>PUBMAXX</Kicker>
          <h1 id="top-ten-title" className="passportTopTenTitle">
            {topTenTitle(card.handle)}
          </h1>
          <ol className="passportTopTenList">
            {card.rows.map((row) => (
              <li key={row.venueId} className="passportTopTenRow">
                <span className="passportTopTenPlace">{row.place}</span>
                <Link prefetch={false} href={venueMapUrl(row.venueId)} className="passportTopTenName">
                  {row.venueName}
                </Link>
                {row.band ? (
                  <span className={`passportBandPlaque ${priceBandClass(row.band)}`}>
                    {priceBandLabel(row.band)}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="passportQuiet">
            <Link href={`/u/${card.handle}`}>See @{card.handle} on PUBMAXX</Link>
          </p>
        </section>
      </main>
    </div>
  );
}
