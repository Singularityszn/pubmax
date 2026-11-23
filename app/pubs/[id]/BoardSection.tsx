import LiveBoardReader from "./LiveBoardReader";
import { BOARD_READ_ACTION, BOARD_READ_KEYLESS_LINE } from "@/lib/boardRead";
import { boardReaderKeyed } from "@/lib/boardRead.server";
import "@/components/board/boardReader.css";

export default function BoardSection({ venueId, venueName }: { venueId: string; venueName: string }) {
  return (
    <section id="board" className="pubPage__section" aria-labelledby="pub-board-title">
      <h2 id="pub-board-title">{BOARD_READ_ACTION}</h2>
      {boardReaderKeyed()
        ? <LiveBoardReader venueId={venueId} venueName={venueName} />
        : <p className="boardReaderLine" role="status">{BOARD_READ_KEYLESS_LINE}</p>}
    </section>
  );
}
