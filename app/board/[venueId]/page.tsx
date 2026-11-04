import type { Metadata, Route } from "next";
import Link from "next/link";
import { connection } from "next/server";

import BoardReader from "@/components/board/BoardReader";
import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import { BOARD_READ_ACTION, BOARD_READ_KEYLESS_LINE } from "@/lib/boardRead";
import { boardReaderKeyed } from "@/lib/boardRead.server";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";

import "@/components/board/boardReader.css";

// /board/[venueId]: the board reader (review item A4). A drinker photographs a
// pub's price board, the Pal proposes the lines it can read, and the drinker
// confirms the right ones. Each confirmed line lands through the community
// price write with the photo as its bill (components/board/BoardReader.tsx).
//
// A private tool, never a landing: not indexed, and nothing on it is a price
// until a person has tapped it. Keyless, the page says the one line and offers
// nothing else, so a deployment with no model key never shows a dead button.

type PageProps = { params: Promise<{ venueId: string }> };

export const metadata: Metadata = {
  title: BOARD_READ_ACTION,
  description: "Photograph a pub's price board and log the prices you check.",
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="boardPage">
      <SiteNav />
      {children}
    </main>
  );
}

export default async function BoardPage({ params }: PageProps): Promise<React.JSX.Element> {
  // Per request: whether the reader is keyed is a fact about this deployment
  // now, and a venue read that failed must never be held as an answer.
  await connection();
  const { venueId } = await params;
  const read = await lookupVenueDetail(venueId);

  if (read.status !== "found" || !isPubVenueKind(read.venue.kind)) {
    return (
      <Shell>
        <Screen
          as="section"
          className="boardScreen"
          kicker={BOARD_READ_ACTION}
          title={read.status === "unavailable" ? "We could not open this pub just now" : "This pub isn't on the map"}
          titleId="board-title"
        >
          <Link prefetch={false} href={"/map" as Route}>Back to the map</Link>
        </Screen>
      </Shell>
    );
  }

  const { venue } = read;
  return (
    <Shell>
      <Screen
        as="section"
        className="boardScreen"
        kicker={BOARD_READ_ACTION}
        title={venue.name}
        titleId="board-title"
      >
        {boardReaderKeyed() ? (
          <BoardReader venueId={venue.id} venueName={venue.name} />
        ) : (
          <p className="boardReaderLine" role="status">{BOARD_READ_KEYLESS_LINE}</p>
        )}
      </Screen>
    </Shell>
  );
}
