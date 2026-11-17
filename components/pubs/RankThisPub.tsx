"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useLiveAccountGeneration } from "@/components/auth/useLiveAccountGeneration";
import { useViewerSession } from "@/components/auth/useViewerSession";
import ComparePubFlow from "@/components/social/ComparePubFlow";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { AuthActionSessionError, authedActionJson } from "@/lib/authedFetch";
import { socialPubRankingPayload, socialPubRankingReadFailure, type SocialPubRankingEntry } from "@/lib/socialPubRankings";

const RANKING_UNAVAILABLE = "Your ranking is unavailable right now.";

type Props = { venueId: string; venueName: string; returnTo: string };

type State =
  | { kind: "idle" }
  | { kind: "loading"; origin: "open" | "closed" }
  | { kind: "failed"; message: string }
  | { kind: "refused"; message: string }
  | { kind: "comparing"; entries: SocialPubRankingEntry[] };

async function readRanking(): Promise<State> {
  try {
    const { response, body } = await authedActionJson<unknown>(
      "/api/social/rankings",
      { credentials: "same-origin" },
      { requiresIdentity: true },
    );
    const entries = response.ok ? socialPubRankingPayload(body) : null;
    if (entries) return { kind: "comparing", entries };
    return {
      kind: socialPubRankingReadFailure(response.status, body) === "refused" ? "refused" : "failed",
      message: response.status === 401 ? RANKING_UNAVAILABLE : errorMessageFrom(response.ok ? null : body, RANKING_UNAVAILABLE),
    };
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
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function open() {
    if (state.kind === "loading" || state.kind === "comparing") return;
    setState({ kind: "loading", origin: "open" });
    const next = await readRanking();
    if (!mounted.current) return;
    if (next.kind === "comparing") setPlaced(next.entries.find((entry) => entry.venueId === venueId) ?? null);
    if (next.kind === "refused") setPlaced(null);
    setState(next);
  }

  function close(value?: unknown) {
    // Older comparison versions pass click events instead of a write promise.
    const pending = value instanceof Promise ? value : undefined;
    setState(pending ? { kind: "loading", origin: "closed" } : { kind: "idle" });
    if (!pending) return;
    const refresh = async () => {
      if (!mounted.current) return;
      const next = await readRanking();
      if (!mounted.current) return;
      if (next.kind === "comparing") {
        setPlaced(next.entries.find((entry) => entry.venueId === venueId) ?? null);
        setState({ kind: "idle" });
      } else {
        if (next.kind === "refused") setPlaced(null);
        setState(next);
      }
    };
    void pending.then(refresh, refresh);
  }

  return (
    <>
      <button type="button" className="pubPage__action" onClick={() => void open()} aria-busy={state.kind === "loading"} aria-disabled={state.kind === "loading" || state.kind === "comparing"}>
        {placed ? `Ranked #${placed.place}` : state.kind === "failed" ? "Try ranking again" : "Rank it"}
      </button>
      <p className={state.kind === "failed" || state.kind === "refused" || (state.kind === "loading" && state.origin === "closed") ? "pubPage__note" : "sr-only"} role="status" style={{ order: 1, flexBasis: "100%" }}>
        {state.kind === "failed" || state.kind === "refused" ? state.message : state.kind === "loading" ? "Checking your ranking…" : ""}
      </p>
      {state.kind === "comparing" ? (
        <ComparePubFlow
          entries={state.entries}
          startVenue={{ id: venueId, name: venueName }}
          onClose={close}
          onSaved={(entries) => setPlaced(entries.find((entry) => entry.venueId === venueId) ?? null)}
        />
      ) : null}
    </>
  );
}
