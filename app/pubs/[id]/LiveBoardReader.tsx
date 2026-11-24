"use client";

import BoardReader from "@/components/board/BoardReader";
import { useLedgerLive } from "@/components/ledger/LedgerLive";

export default function LiveBoardReader({ venueId, venueName }: { venueId: string; venueName: string }) {
  const { reload } = useLedgerLive();

  return <BoardReader venueId={venueId} venueName={venueName} onLogged={reload} />;
}
