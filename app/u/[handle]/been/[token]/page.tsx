import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import PintReceiptPaper from "@/components/pintdrop/PintReceiptPaper";
import Kicker from "@/components/ui/kicker";
import SiteNav from "@/components/nav/SiteNav";
import { BEEN_CARD_COPY, beenCardCountedLine, beenCardTitle } from "@/lib/beenCard";
import { readBeenCard } from "@/lib/beenCardShare.server";

import "../../profile.css";
import "@/components/profile/beenCard.css";

// A shared Been card. The link exists only because the owner tapped "Share
// your Been card" with enough pubs on their list; the page prints the signed
// count with its day, and the cheapest pint as its receipt while that drop
// still stands (lib/beenCardShare.server.ts). It names no pub from the Been
// list, and it is kept out of search.

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
  const card = await readBeenCard(handle, decode(token));
  const title = card ? beenCardTitle(card.handle, card.pubs) : BEEN_CARD_COPY.kicker;
  return {
    title,
    robots: { index: false, follow: false },
    openGraph: { title, type: "article", siteName: "PUBMAXX" },
    twitter: { card: "summary_large_image", title },
  };
}

export default async function BeenCardSharePage({ params }: PageProps) {
  const { handle, token } = await params;
  const card = await readBeenCard(handle, decode(token));
  if (!card) notFound();

  return (
    <div className="lp profilePage">
      <SiteNav active="profile" />
      <main id="main" className="container profileMain">
        <section className="beenCard" aria-labelledby="been-card-title">
          <Kicker>{BEEN_CARD_COPY.kicker}</Kicker>
          <h1 id="been-card-title" className="beenCard__title">
            {beenCardTitle(card.handle, card.pubs)}
          </h1>
          <p className="beenCard__line">{beenCardCountedLine(card.issuedAt)}</p>
          {card.receipt && card.dropId ? (
            <div className="beenCard__pint">
              <h2 className="beenCard__label">{BEEN_CARD_COPY.cheapestLabel}</h2>
              <div className="beenCard__counter">
                <PintReceiptPaper receipt={card.receipt} variant="stub" />
              </div>
              <p className="beenCard__line">
                <Link prefetch={false} href={`/p/${encodeURIComponent(card.dropId)}`}>
                  {BEEN_CARD_COPY.openReceipt}
                </Link>
              </p>
            </div>
          ) : null}
          <p className="beenCard__line">
            <Link prefetch={false} href={`/u/${card.handle}`}>See @{card.handle} on PUBMAXX</Link>
          </p>
        </section>
      </main>
    </div>
  );
}
