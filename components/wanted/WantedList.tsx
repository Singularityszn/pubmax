"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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

type WantedFulfilEventDetail = {
  note?: string;
  userId?: string | null;
};

type WantedFetchStatus = "loading" | "ready" | "sign_in" | "error";

type WantedAccountState = {
  userId: string;
  wanteds: WantedDTO[];
  fetchStatus: WantedFetchStatus;
  fulfilNote: string | null;
};

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
  const { supabaseAuthState, user } = useAuth();
  const userId = supabaseAuthState === "authenticated" ? user?.id ?? null : null;
  const activeUserId = useRef<string | null>(userId);
  const requestRevision = useRef(0);
  useLayoutEffect(() => {
    activeUserId.current = userId;
  }, [userId]);
  const [accountState, setAccountState] = useState<WantedAccountState | null>(null);

  const refresh = useCallback(async () => {
    if (supabaseAuthState !== "authenticated" || !userId) return;
    const requestUserId = userId;
    const revision = ++requestRevision.current;
    try {
      const res = await authedFetch("/api/wanted");
      const body = (await res.json()) as {
        wanteds?: WantedDTO[];
        status?: string;
        error?: string;
      };
      if (
        activeUserId.current !== requestUserId ||
        requestRevision.current !== revision
      ) {
        return;
      }
      if (res.status === 401 || body.status === "sign_in_required") {
        setAccountState((current) => ({
          userId: requestUserId,
          wanteds: [],
          fetchStatus: "sign_in",
          fulfilNote: current?.userId === requestUserId ? current.fulfilNote : null,
        }));
        return;
      }
      if (!res.ok) {
        setAccountState((current) => ({
          userId: requestUserId,
          wanteds: current?.userId === requestUserId ? current.wanteds : [],
          fetchStatus: "error",
          fulfilNote: current?.userId === requestUserId ? current.fulfilNote : null,
        }));
        return;
      }
      setAccountState((current) => ({
        userId: requestUserId,
        wanteds: Array.isArray(body.wanteds) ? body.wanteds : [],
        fetchStatus: "ready",
        fulfilNote: current?.userId === requestUserId ? current.fulfilNote : null,
      }));
    } catch {
      if (
        activeUserId.current !== requestUserId ||
        requestRevision.current !== revision
      ) {
        return;
      }
      setAccountState((current) => ({
        userId: requestUserId,
        wanteds: current?.userId === requestUserId ? current.wanteds : [],
        fetchStatus: "error",
        fulfilNote: current?.userId === requestUserId ? current.fulfilNote : null,
      }));
    }
  }, [supabaseAuthState, userId]);

  useEffect(() => {
    // The only reason to ask is an account to ask for.
    if (!userId) return;
    void Promise.resolve().then(() => refresh());
  }, [refresh, userId]);

  const currentAccountState = accountState?.userId === userId ? accountState : null;
  const fulfilNote = currentAccountState?.fulfilNote ?? null;
  const handleSaved = useCallback(
    (wanted: WantedDTO) => {
      if (!userId || activeUserId.current !== userId) return;
      setAccountState((current) => ({
        userId,
        wanteds: [
          wanted,
          ...(current?.userId === userId
            ? current.wanteds.filter((row) => row.id !== wanted.id)
            : []),
        ],
        fetchStatus: "ready",
        fulfilNote: current?.userId === userId ? current.fulfilNote : null,
      }));
    },
    [userId],
  );
  const handleFulfilNote = useCallback(
    (note: string | null, eventUserId?: string | null) => {
      if (!userId || eventUserId !== userId || activeUserId.current !== userId) return;
      setAccountState((current) => ({
        userId,
        wanteds: current?.userId === userId ? current.wanteds : [],
        fetchStatus: current?.userId === userId ? current.fetchStatus : "loading",
        fulfilNote: note,
      }));
    },
    [userId],
  );
  const handleFulfilRefresh = useCallback((eventUserId?: string | null) => {
    if (!userId || eventUserId !== userId || activeUserId.current !== userId) return;
    void refresh();
  }, [refresh, userId]);

  // What the session says is DERIVED, never stored: a signed-out answer is not
  // a fetch result, and writing it into state would both cascade a render and
  // leave the previous account's rows to be un-set afterwards. Deriving means
  // a sign-out hides them in the same paint, which is the law
  // __tests__/wantedPlanChipsAuth.test.ts already holds for the plan chips.
  const loadStatus =
    supabaseAuthState === "signed-out"
      ? "sign_in"
      : supabaseAuthState !== "authenticated" || !userId
        ? "loading"
        : currentAccountState?.fetchStatus ?? "loading";
  const owned = currentAccountState?.wanteds ?? [];

  const open = owned.filter((row) => row.status === "open");
  const fulfilled = owned.filter((row) => row.status === "fulfilled");

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
          onSaved={handleSaved}
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

      <WantedFulfilListener onNote={handleFulfilNote} onRefresh={handleFulfilRefresh} />
    </section>
  );
}

function WantedFulfilListener({
  onNote,
  onRefresh,
}: {
  onNote: (note: string | null, userId?: string | null) => void;
  onRefresh: (userId?: string | null) => void;
}): null {
  useEffect(() => {
    function onEvent(event: Event) {
      const detail = (event as CustomEvent<WantedFulfilEventDetail>).detail;
      if (detail?.note) onNote(detail.note, detail.userId);
      onRefresh(detail?.userId);
    }
    window.addEventListener("pubmax:wanted-fulfilled", onEvent);
    return () => window.removeEventListener("pubmax:wanted-fulfilled", onEvent);
  }, [onNote, onRefresh]);
  return null;
}
