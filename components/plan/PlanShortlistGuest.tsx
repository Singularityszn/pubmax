"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { getAnonId } from "@/lib/anonId";
import { trackEvent } from "@/lib/analytics";
import { errorMessageFrom, offlineOrMessage, readApiJson } from "@/lib/apiErrorMessage";
import { restorePlanCapability } from "@/lib/planSessionCapability";
import type { ShortlistView } from "@/lib/planShortlist";
import { ConfirmedShortlist, ShortlistOptionDetails } from "./PlanShortlistCard";

export default function PlanShortlistGuest({
  initial, token, planId,
}: {
  initial: ShortlistView;
  token: string;
  planId: string;
}) {
  const [view, setView] = useState<ShortlistView | null>(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const recorded = useRef(false);
  const version = useRef(0);
  const requestPending = useRef(false);
  const endpoint = `/api/invite/${token}/vote`;

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      if (requestPending.current) return;
      const current = ++version.current;
      try {
        const response = await fetch(endpoint, {
          signal: controller.signal, headers: { "x-invite-voter": getAnonId() },
        });
        const body = await readApiJson(response) as { shortlist?: ShortlistView } | null;
        if (controller.signal.aborted || version.current !== current) return;
        if (response.status === 404 || response.status === 410) {
          setView(null);
          setMessage(errorMessageFrom(body, "This invite link is no longer valid."));
        } else if (response.ok && body?.shortlist) {
          setView(body.shortlist);
        }
      } catch {
        // The page still holds the server-rendered shortlist.
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    void restorePlanCapability(planId).then((capability) => {
      if (controller.signal.aborted || recorded.current || capability?.role === "host") return;
      recorded.current = true;
      trackEvent("plan_shortlist_invite_opened");
    }).catch(() => undefined);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [endpoint, planId]);

  async function vote(venueId: string) {
    if (requestPending.current) return;
    const id = getAnonId();
    if (!id) {
      setMessage("Enable browser storage to save your vote.");
      return;
    }
    requestPending.current = true;
    version.current++;
    setPending(true);
    setMessage("");
    try {
      const headers = { "content-type": "application/json", "x-invite-voter": id };
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ venueId }) });
      const result = await readApiJson(response) as { shortlist?: ShortlistView; changed?: boolean } | null;
      if (response.ok && result?.shortlist) {
        setView(result.shortlist);
        if (result.changed) trackEvent("plan_shortlist_vote_submitted");
        setMessage("Vote saved");
        return;
      }
      if (response.status === 409) {
        const latest = await fetch(endpoint, { headers });
        const update = await readApiJson(latest) as { shortlist?: ShortlistView } | null;
        if (latest.ok && update?.shortlist) setView(update.shortlist);
        if (latest.status === 404 || latest.status === 410) setView(null);
      }
      if (response.status === 404 || response.status === 410) setView(null);
      setMessage(errorMessageFrom(result, "Could not save your vote. Try again."));
    } catch {
      setMessage(offlineOrMessage("Could not save your vote. Try again."));
    } finally {
      requestPending.current = false;
      setPending(false);
    }
  }

  return (
    <div className="planShortlist planShortlist__guest">
      <h1 className="invite__title">{view?.confirmed ? "Group night confirmed" : "Group night"}</h1>
      {view?.confirmed ? <ConfirmedShortlist view={view} /> : null}
      {view && !view.confirmed ? (
        <>
          <p>Pick one pub. You can change your vote until the organiser confirms.</p>
          <div className="planShortlist__options">
            {view.options.map((option) => {
              const count = view.counts[option.venueId];
              return (
                <article className="planShortlist__option" key={option.venueId}>
                  <h2>{option.venueName}</h2>
                  <ShortlistOptionDetails option={option} />
                  <div className="planShortlist__actions">
                    <Button type="button" variant="secondary" disabled={pending}
                      aria-pressed={view.myVote === option.venueId} onClick={() => void vote(option.venueId)}>
                      Vote for {option.venueName}
                    </Button>
                    <span>{count} {count === 1 ? "vote" : "votes"}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
