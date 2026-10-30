import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Kicker from "@/components/ui/kicker";
import SiteNav from "@/components/nav/SiteNav";
import { boroughBingoCountLine } from "@/lib/boroughBingo";
import { readBoroughBingoCard } from "@/lib/boroughBingoShare.server";

import "@/components/profile/boroughBingo.css";

// A shared borough bingo mark. The link exists only because the owner tapped
// "Share your card" at 11, 22 or 33 boroughs; the page prints the signed mark
// from that tap and never reads the live card (lib/boroughBingoShare.server.ts).
// It names no borough and no pub, and it is kept out of search.

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
  const card = await readBoroughBingoCard(handle, decode(token));
  const title = card ? `@${card.handle}, ${boroughBingoCountLine(card.mark)}` : "Borough bingo";
  return {
    title,
    robots: { index: false, follow: false },
    openGraph: { title, type: "article", siteName: "PUBMAXX" },
    twitter: { card: "summary_large_image", title },
  };
}

export default async function BoroughBingoSharePage({ params }: PageProps) {
  const { handle, token } = await params;
  const card = await readBoroughBingoCard(handle, decode(token));
  if (!card) notFound();

  return (
    <div className="lp profilePage">
      <SiteNav active="profile" />
      <main id="main" className="container profileMain">
        <section className="boroughBingo boroughBingo--shared" aria-labelledby="borough-bingo-title">
          <Kicker>Borough bingo</Kicker>
          <h1 id="borough-bingo-title" className="boroughBingo__title">
            @{card.handle}: {boroughBingoCountLine(card.mark)}
          </h1>
          <p className="boroughBingo__line">
            One square for each London borough and the City, filled by the first pint logged there.
          </p>
          <p className="boroughBingo__line">
            <Link href={`/u/${card.handle}`}>See @{card.handle} on PUBMAXX</Link>
          </p>
        </section>
      </main>
    </div>
  );
}
