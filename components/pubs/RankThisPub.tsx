"use client";

import Link from "next/link";
import { useState } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import ComparePubFlow from "@/components/social/ComparePubFlow";
import { authedFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import type { SocialPubRankingEntry } from "@/lib/socialPubRankings";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "comparing"; entries: SocialPubRankingEntry[] };

/**
 * "Rank it", from the pub's own page: the same "which did you prefer?" flow
 * the Social page opens, started on this pub, so a reader who has just been
 * goes straight to how it went. A signed-out reader is offered the sign-in
 * door instead, back to this page.
 */
export default function RankThisPub({ venueId, venueName, returnTo }: { venueId: string; venueName: string; returnTo: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [placed, setPlaced] = useState<SocialPubRankingEntry | null>(null);
  const { signedOut } = useViewerSession();

  async function open() {
    setState({ kind: "loading" });
    try {
      const response = await authedFetch("/api/social/rankings", { credentials: "same-origin" }, { requiresIdentity: true });
      if (!response.ok) {
        discardBody(response);
        setState({ kind: "signedOut" });
        return;
      }
      const body = (await response.json()) as { entries?: SocialPubRankingEntry[] };
      setState({ kind: "comparing", entries: body.entries ?? [] });
    } catch {
      setState({ kind: "signedOut" });
    }
  }

  if (signedOut || state.kind === "signedOut") {
    return (
      <Link className="pubPage__action" prefetch={false} href={`/login?mode=signin&from=${encodeURIComponent(returnTo)}`}>
        Sign in to rank it
      </Link>
    );
  }
  return (
    <>
      <button type="button" className="pubPage__action" onClick={() => void open()} disabled={state.kind === "loading"}>
        {placed ? `Ranked #${placed.place}` : "Rank it"}
      </button>
      {state.kind === "comparing" ? (
        <ComparePubFlow
          entries={state.entries}
          startVenue={{ id: venueId, name: venueName }}
          onClose={() => setState({ kind: "idle" })}
          onSaved={(entries) => setPlaced(entries.find((entry) => entry.venueId === venueId) ?? null)}
        />
      ) : null}
    </>
  );
}
