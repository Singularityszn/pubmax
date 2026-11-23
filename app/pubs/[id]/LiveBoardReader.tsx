"use client";

import { useRouter } from "next/navigation";
import BoardReader from "@/components/board/BoardReader";
import { useLedgerLive } from "@/components/ledger/LedgerLive";

export default function LiveBoardReader({ venueId, venueName }: { venueId: string; venueName: string }) {
  const router = useRouter();
  const { reload } = useLedgerLive();

  return <BoardReader venueId={venueId} venueName={venueName} onLogged={() => {
    reload();
    router.refresh();
  }} />;
}
