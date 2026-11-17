"use client";

import Link from "next/link";
import { useEffect, useReducer } from "react";

import { useLiveAccountGeneration } from "@/components/auth/useLiveAccountGeneration";
import { useViewerSession } from "@/components/auth/useViewerSession";
import ComparePubFlow from "@/components/social/ComparePubFlow";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { AuthActionJsonParseError, AuthActionSessionError, authedActionJson } from "@/lib/authedFetch";
import { initialPubPageRanking, transitionPubPageRanking, type PubPageRankingRead } from "@/lib/pubPageRankingSession";
import { socialPubRankingPayload, socialPubRankingReadFailure } from "@/lib/socialPubRankings";

const RANKING_UNAVAILABLE = "Your ranking is unavailable right now.";
const RANKING_ACCESS_REFUSED = "We could not confirm access to your ranking.";

type Props = { venueId: string; venueName: string; returnTo: string };

async function readRanking(): Promise<PubPageRankingRead> {
  try {
    const { response, body } = await authedActionJson<unknown>(
      "/api/social/rankings",
      { credentials: "same-origin" },
      { requiresIdentity: true },
    );
    const entries = response.ok ? socialPubRankingPayload(body) : null;
    if (entries) return { kind: "entries", entries };
    const refused = socialPubRankingReadFailure(response.status, body) === "refused";
    return {
      kind: refused ? "refused" : "failed",
      message: response.status === 401 ? RANKING_ACCESS_REFUSED
        : errorMessageFrom(response.ok ? null : body, refused ? RANKING_ACCESS_REFUSED : RANKING_UNAVAILABLE),
    };
  } catch (error) {
    if (error instanceof AuthActionJsonParseError && socialPubRankingReadFailure(error.status, null) === "refused") {
      return { kind: "refused", message: RANKING_ACCESS_REFUSED };
    }
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
  const scope = `${generation}:${props.venueId}`;
  return <RankIt key={scope} {...props} scope={scope} />;
}

function RankIt({ venueId, venueName, scope }: Props & { scope: string }) {
  const [state, send] = useReducer(transitionPubPageRanking, initialPubPageRanking(scope, venueId));
  const placed = state.checkpoint;

  useEffect(() => {
    if (state.kind !== "loading") return;
    let active = true;
    const read = async () => {
      if (state.origin === "closed") await state.pendingWrite;
      if (!active) return;
      const result = await readRanking();
      if (active) send({ type: "read", scope: state.scope, requestId: state.requestId, result });
    };
    void read();
    return () => { active = false; };
  }, [state]);

  function close(value?: unknown, reason?: "refused") {
    if (reason === "refused") {
      send({ type: "refused", scope, requestId: state.requestId, message: RANKING_ACCESS_REFUSED });
      return;
    }
    // Older comparison versions pass click events instead of a write promise.
    const pendingWrite = value instanceof Promise ? value.then(() => undefined, () => undefined) : undefined;
    send({ type: "close", scope, requestId: state.requestId, pendingWrite });
  }

  return (
    <>
      <button type="button" className="pubPage__action" onClick={() => send({ type: "open" })} aria-busy={state.kind === "loading"} aria-disabled={state.kind === "loading" || state.kind === "comparing"}>
        {placed ? `Ranked #${placed.place}` : state.kind === "failed" ? "Try ranking again" : "Rank it"}
      </button>
      <p className={`pubPage__rankingStatus ${state.kind === "failed" || state.kind === "refused" || (state.kind === "loading" && state.origin === "closed") ? "pubPage__note" : "sr-only"}`} role="status">
        {state.kind === "failed" || state.kind === "refused" ? state.message : state.kind === "loading" ? "Checking your ranking…" : ""}
      </p>
      {state.kind === "comparing" ? (
        <ComparePubFlow
          entries={state.entries}
          startVenue={{ id: venueId, name: venueName }}
          onClose={close}
          onSaved={(entries) => send({ type: "saved", scope, requestId: state.requestId, entries })}
        />
      ) : null}
    </>
  );
}
