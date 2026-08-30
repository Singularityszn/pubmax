"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedFetch } from "@/lib/authedFetch";
import {
  isWantedPromotable,
  wantedPendingLabel,
  type WantedDTO,
} from "@/lib/wanted";
import { venueMapUrl } from "@/lib/venueMapUrl";

import WantedCapture from "./WantedCapture";
import WantedPromotionControl from "./WantedPromotionControl";
import "./wanted.css";

function mapUrlFor(wanted: WantedDTO): string | null {
  if (!wanted.venueId) return null;
  try {
    return venueMapUrl(wanted.venueId);
  } catch {
    return `/map?sel=${encodeURIComponent(wanted.venueId)}`;
  }
}

export default function WantedList(): React.JSX.Element {
  // Wanted is owner-only, so asking for it without a session is a question we
  // already know the answer to. A cold /you fired GET /api/wanted anyway and
  // took a 401 to learn what the browser could have told it, which is console
  // noise on the first page a stranger opens.
  //
  // `supabaseAuthState` is the auth readiness contract, and it is three-way for
  // the reason every identity read here is: `loading` can go false while a
  // durable resume is still restoring an account, so "not signed in" and "not
  // asked yet" are different answers and only one of them may say Sign in.
  const { supabaseAuthState } = useAuth();
  const [wanteds, setWanteds] = useState<WantedDTO[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "sign_in" | "error">(
    "loading",
  );
  const [fulfilNote, setFulfilNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authedFetch("/api/wanted");
      const body = (await res.json()) as {
        wanteds?: WantedDTO[];
        status?: string;
        error?: string;
      };
      if (res.status === 401 || body.status === "sign_in_required") {
        setLoadStatus("sign_in");
        setWanteds([]);
        return;
      }
      if (!res.ok) {
        setLoadStatus("error");
        return;
      }
      setWanteds(Array.isArray(body.wanteds) ? body.wanteds : []);
      setLoadStatus("ready");
    } catch {
      setLoadStatus("error");
    }
  }, []);

  useEffect(() => {
    // Unresolved is not signed out: hold the loading shape rather than claim
    // either answer.
    if (supabaseAuthState === "unresolved") return;
    if (supabaseAuthState === "signed-out") {
      setLoadStatus("sign_in");
      setWanteds([]);
      return;
    }
    void Promise.resolve().then(() => refresh());
  }, [refresh, supabaseAuthState]);

  const open = wanteds.filter((row) => row.status === "open");
  const fulfilled = wanteds.filter((row) => row.status === "fulfilled");

  return (
    <section className="wantedPanel" id="wanted" aria-labelledby="wanted-heading">
      <h2 id="wanted-heading" className="wantedPanel__title">
        Wanted
      </h2>
      <p className="wantedPanel__lede">
        Paste a pub name or a link you saved elsewhere. It becomes a place you can plan
        around. We store the link as provenance and never fetch Instagram or TikTok.
      </p>

      {loadStatus === "sign_in" ? (
        <p className="wantedPanel__empty">Sign in to keep a Wanted list.</p>
      ) : (
        <WantedCapture
          onSaved={(wanted) => {
            setWanteds((prev) => [wanted, ...prev.filter((row) => row.id !== wanted.id)]);
            setLoadStatus("ready");
          }}
        />
      )}

      {fulfilNote ? (
        <p className="wantedFulfilNote" role="status">
          {fulfilNote}
        </p>
      ) : null}

      {loadStatus === "loading" ? (
        <p className="wantedPanel__empty">Loading your Wanted list…</p>
      ) : null}
      {loadStatus === "error" ? (
        <p className="wantedPanel__empty">Could not load Wanted places right now.</p>
      ) : null}

      {loadStatus === "ready" && open.length === 0 ? (
        <p className="wantedPanel__empty">No open Wanted places yet.</p>
      ) : null}

      {open.length > 0 ? (
        <ul className="wantedList" aria-label="Open Wanted places">
          {open.map((wanted) => {
            const href = mapUrlFor(wanted);
            const title =
              wanted.venueKind === "pending"
                ? wantedPendingLabel(wanted.rawPaste)
                : wanted.venueName;
            return (
              <li key={wanted.id} className="wantedRow">
                <div>
                  <p className="wantedRow__name">{title}</p>
                  <p className="wantedRow__meta">
                    {wanted.venueKind === "uk_base"
                      ? "UK pub · mark only, no invented pint price"
                      : wanted.venueKind === "pending"
                        ? "Still matching"
                        : "On the priced map"}
                    {wanted.sourceUrl ? " · link saved as provenance" : ""}
                    {wanted.note ? ` · ${wanted.note}` : ""}
                  </p>
                </div>
                {href || isWantedPromotable(wanted) ? (
                  <div className="wantedRow__actions">
                    {href ? (
                      <a className="wantedRow__map" href={href}>
                        Open map
                      </a>
                    ) : null}
                    {isWantedPromotable(wanted) || wanted.promotedListType ? (
                      <WantedPromotionControl
                        wantedId={wanted.id}
                        promotedListType={wanted.promotedListType}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {fulfilled.length > 0 ? (
        <ul className="wantedList" aria-label="Fulfilled Wanted places">
          {fulfilled.slice(0, 5).map((wanted) => (
            <li key={wanted.id} className="wantedRow">
              <div>
                <p className="wantedRow__name">{wanted.venueName || wantedPendingLabel(wanted.rawPaste)}</p>
                <p className="wantedRow__meta">Done</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Keep setFulfilNote reachable for presence celebrate handoff via custom event. */}
      <WantedFulfilListener onNote={setFulfilNote} onRefresh={() => void refresh()} />
    </section>
  );
}

function WantedFulfilListener({
  onNote,
  onRefresh,
}: {
  onNote: (note: string | null) => void;
  onRefresh: () => void;
}): null {
  useEffect(() => {
    function onEvent(event: Event) {
      const detail = (event as CustomEvent<{ note?: string }>).detail;
      if (detail?.note) onNote(detail.note);
      onRefresh();
    }
    window.addEventListener("pubmax:wanted-fulfilled", onEvent);
    return () => window.removeEventListener("pubmax:wanted-fulfilled", onEvent);
  }, [onNote, onRefresh]);
  return null;
}
