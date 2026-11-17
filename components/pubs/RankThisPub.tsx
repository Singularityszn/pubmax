"use client";

import Link from "next/link";
import { useState } from "react";

import { useLiveAccountGeneration } from "@/components/auth/useLiveAccountGeneration";
import { useViewerSession } from "@/components/auth/useViewerSession";
import ComparePubFlow from "@/components/social/ComparePubFlow";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { AuthActionSessionError, authedActionJson } from "@/lib/authedFetch";
import { isSocialPubBand, type SocialPubRankingEntry } from "@/lib/socialPubRankings";

const RANKING_UNAVAILABLE = "Your ranking is unavailable right now.";

type Props = { venueId: string; venueName: string; returnTo: string };

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "comparing"; entries: SocialPubRankingEntry[] };

function rankingEntries(body: unknown): SocialPubRankingEntry[] | null {
  const entries = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return null;
  const valid = entries.every((entry: Partial<SocialPubRankingEntry> | null) =>
    typeof entry?.venueId === "string" &&
    isSocialPubBand(entry.band) &&
    typeof entry.place === "number" &&
    typeof entry.score === "number");
  return valid ? (entries as SocialPubRankingEntry[]) : null;
}

async function readRanking(): Promise<State> {
  try {
    const { response, body } = await authedActionJson<unknown>(
      "/api/social/rankings",
      { credentials: "same-origin" },
      { requiresIdentity: true },
    );
    const entries = response.ok ? rankingEntries(body) : null;
    if (entries) return { kind: "comparing", entries };
    // A 401 here means the server did not see a session the browser has not
    // settled as signed out, so it is a wait, not a sign-in invitation.
    if (response.status === 401) return { kind: "failed", message: new AuthActionSessionError().message };
    return { kind: "failed", message: errorMessageFrom(response.ok ? null : body, RANKING_UNAVAILABLE) };
  } catch (error) {
    return {
      kind: "failed",
      message: error instanceof AuthActionSessionError ? error.message : offlineOrMessage(RANKING_UNAVAILABLE),
    };
  }
}

/**
 * "Rank it", from the pub's own page: the same "which did you prefer?" flow
 * the Social page opens, started on this pub, so a reader who has just been
 * goes straight to how it went. Only a settled signed-out session gets the
 * sign-in door. Keyed on the live account, so a read or a list never outlives
 * the account it was for.
 */
export default function RankThisPub(props: Props) {
  const { signedOut } = useViewerSession();
  const generation = useLiveAccountGeneration();
  if (signedOut) {
    return (
      <Link className="pubPage__action" prefetch={false} href={`/login?mode=signin&from=${encodeURIComponent(props.returnTo)}`}>
        Sign in to rank it
      </Link>
    );
  }
  return <RankIt key={generation} {...props} />;
}

function RankIt({ venueId, venueName }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [placed, setPlaced] = useState<SocialPubRankingEntry | null>(null);

  async function open() {
    setState({ kind: "loading" });
    setState(await readRanking());
  }

  return (
    <>
      <button type="button" className="pubPage__action" onClick={() => void open()} disabled={state.kind === "loading"}>
        {placed ? `Ranked #${placed.place}` : "Rank it"}
      </button>
      {state.kind === "failed" ? (
        // Its own line under the action row, not a wedge between two pills.
        <p className="pubPage__note" role="status" style={{ order: 1, flexBasis: "100%" }}>{state.message}</p>
      ) : null}
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
