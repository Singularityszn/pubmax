"use client";

// The owner's Been card door in the passport's Been section (lib/beenCard.ts).
// Below the unlock count it is one quiet line saying how many pubs are left.
// At the unlock count it is a button: the server counts the list itself and
// signs the link (app/api/profiles/[handle]/been-card), and the share (the OS
// sheet, then the clipboard) is loaded on tap.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/authedFetch";
import { BEEN_CARD_COPY, beenCardLockedLine, beenCardUnlocked } from "@/lib/beenCard";
import { discardBody } from "@/lib/responseBody";

import "./beenCard.css";

export default function BeenCardShare({
  handle,
  count,
}: {
  handle: string;
  count: number;
}): React.JSX.Element | null {
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function share() {
    setBusy(true);
    setLine(null);
    try {
      const response = await authedFetch(
        `/api/profiles/${encodeURIComponent(handle)}/been-card`,
        { cache: "no-store" },
        { requiresIdentity: true },
      );
      if (!response.ok) {
        await discardBody(response);
        throw new Error("mint failed");
      }
      const body = (await response.json().catch(() => ({}))) as { path?: unknown; pubs?: unknown };
      if (typeof body.path !== "string" || typeof body.pubs !== "number") throw new Error("mint failed");
      const { shareBeenCard } = await import("@/lib/pintShareAction");
      const outcome = await shareBeenCard({ path: body.path, handle, pubs: body.pubs });
      if (outcome === "copied") setLine(BEEN_CARD_COPY.ready);
      else if (outcome === "failed") setLine(BEEN_CARD_COPY.failed);
    } catch {
      setLine(BEEN_CARD_COPY.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!beenCardUnlocked(count)) {
    // An empty list has its own empty state, so the line starts at one pub.
    const locked = count > 0 ? beenCardLockedLine(count) : null;
    return locked ? <p className="passportQuiet">{locked}</p> : null;
  }

  return (
    <div className="beenCardDoor">
      <Button type="button" variant="secondary" onClick={() => void share()} disabled={busy}>
        {BEEN_CARD_COPY.share}
      </Button>
      {line ? (
        <p className="passportQuiet" role="status">
          {line}
        </p>
      ) : null}
    </div>
  );
}
