"use client";

// Borough bingo on a profile (launch review D8). The owner sees the card: 33
// squares, one for each London borough and the City, each filled by the
// passport's own borough stamp. A mutual sees the count line only. Anybody
// else sees nothing. Breadth, never volume: a second pint in a borough fills
// nothing more (lib/boroughBingo.ts). No rank, no streak, no comparison.
//
// At 11, 22 and 33 the owner may share the mark. The server counts the stamps
// itself and signs the link (app/api/profiles/[handle]/borough-bingo).

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/authedFetch";
import {
  boroughBingoCountLine,
  boroughBingoMark,
  boroughBingoView,
  buildBoroughBingo,
} from "@/lib/boroughBingo";
import { discardBody } from "@/lib/responseBody";

import "./boroughBingo.css";

export default function BoroughBingo({
  handle,
  boroughs,
  isOwner,
  isMutual,
}: {
  handle: string;
  boroughs: readonly string[];
  isOwner: boolean;
  isMutual: boolean;
}): React.JSX.Element | null {
  const [shareLine, setShareLine] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const view = boroughBingoView({ isOwner, isMutual });
  if (view === "none" || !handle || handle === "you") return null;
  const card = buildBoroughBingo(boroughs);
  const countLine = boroughBingoCountLine(card.filled);

  if (view === "count") {
    return (
      <p className="boroughBingo__line boroughBingo__count" data-testid="borough-bingo-count">
        Borough bingo: {countLine}
      </p>
    );
  }

  const mark = boroughBingoMark(card.filled);

  async function share() {
    setSharing(true);
    setShareLine(null);
    try {
      const response = await authedFetch(
        `/api/profiles/${encodeURIComponent(handle)}/borough-bingo`,
        { cache: "no-store" },
        { requiresIdentity: true },
      );
      if (!response.ok) {
        await discardBody(response);
        throw new Error("share failed");
      }
      const body = (await response.json().catch(() => ({}))) as { path?: unknown };
      if (typeof body.path !== "string") throw new Error("share failed");
      const url = new URL(body.path, window.location.origin).toString();
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `@${handle}: ${countLine}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        setShareLine("Link copied.");
      }
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setShareLine("That link did not make it. Try again shortly.");
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <section id="borough-bingo" className="boroughBingo" aria-labelledby="borough-bingo-title" data-testid="borough-bingo">
      <div className="boroughBingo__head">
        <h2 id="borough-bingo-title" className="boroughBingo__title">
          Borough bingo
        </h2>
        {mark ? (
          <Button type="button" variant="secondary" onClick={() => void share()} disabled={sharing}>
            Share your card
          </Button>
        ) : null}
      </div>
      <p className="boroughBingo__line" data-testid="borough-bingo-count">
        {countLine}. One square for each borough and the City, filled by the first pint you log there.
      </p>
      {shareLine ? (
        <p className="boroughBingo__line" role="status">
          {shareLine}
        </p>
      ) : null}
      <ul className="boroughBingo__grid" aria-label={countLine}>
        {card.squares.map((square) => (
          <li
            key={square.slug}
            className="boroughBingo__square"
            data-filled={square.filled ? "" : undefined}
            aria-label={`${square.name}, ${square.filled ? "stamped" : "not yet"}`}
          >
            {square.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
