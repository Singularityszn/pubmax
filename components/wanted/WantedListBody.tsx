"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import ContributionGateDoor from "@/components/identity/ContributionGateDoor";
import { authedFetch } from "@/lib/authedFetch";
import {
  readProviderAccountRevision,
  readProviderAccountSignal,
} from "@/lib/authProviderRevision";
import {
  readContributionDoor,
  type ContributionDoorStatus,
} from "@/lib/contributionGateStatus";
import {
  isWantedPromotable,
  wantedPendingLabel,
  type WantedDTO,
} from "@/lib/wanted";
import { venueMapUrl } from "@/lib/venueMapUrl";

import WantedCapture from "./WantedCapture";
import WantedPromotionControl from "./WantedPromotionControl";
import WantedRowManage from "./WantedRowManage";

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

// "gated" is not a failure: a new account has not tapped "I'm 18 or over" yet,
// so the read answers the gate as data and the panel shows its door.
type WantedFetchStatus = "loading" | "ready" | "sign_in" | "error" | "gated";

type WantedAccountState = {
  userId: string | null;
  accountRevision: number;
  wanteds: WantedDTO[];
  fetchStatus: WantedFetchStatus;
  door?: ContributionDoorStatus;
  fulfilNote: string | null;
};

export default function WantedListBody(): React.JSX.Element {
  // Wanted is owner-only, so asking for it without a session is a question we
  // already know the answer to. A cold /you fired GET /api/wanted anyway and
  // took a 401 to learn what the browser could have told it, which is console
  // noise on the first page a stranger opens.
  //
  // `supabaseAuthState` is the auth readiness contract, and it is three-way for
  // the reason every identity read here is: `loading` can go false while a
  // durable resume is still restoring an account, so "not signed in" and "not
  // asked yet" are different answers and only one of them may say Sign in.
  const { accountRevision = 0, getCurrentUserId, supabaseAuthState, user } = useAuth();
  const viewerSession = useViewerSession();
  const userId = viewerSession.signedIn ? user?.id ?? null : null;
  const activeUserId = useRef<string | null>(userId);
  const activeAccountRevision = useRef(accountRevision);
  const requestRevision = useRef(0);
  useLayoutEffect(() => {
    activeUserId.current = userId;
    activeAccountRevision.current = accountRevision;
  }, [accountRevision, userId]);
  const [accountState, setAccountState] = useState<WantedAccountState | null>(null);
  const [anonymousWanteds, setAnonymousWanteds] = useState<WantedDTO[]>([]);

  const refresh = useCallback(async () => {
    if (supabaseAuthState !== "authenticated" || !userId) return;
    const requestUserId = userId;
    const requestAccountRevision = accountRevision;
    const requestProviderAccountRevision = readProviderAccountRevision();
    const isCurrentRequest = () =>
      getCurrentUserId() === requestUserId &&
      activeUserId.current === requestUserId &&
      activeAccountRevision.current === requestAccountRevision &&
      readProviderAccountRevision() === requestProviderAccountRevision;
    if (!isCurrentRequest()) {
      return;
    }
    const revision = ++requestRevision.current;
    const requestAccountSignal = readProviderAccountSignal();
    try {
      const res = await authedFetch("/api/wanted", { signal: requestAccountSignal }, { requiresIdentity: true });
      const body = (await res.json()) as {
        wanteds?: WantedDTO[];
        status?: string;
        error?: string;
      };
      if (!isCurrentRequest() || requestRevision.current !== revision) {
        return;
      }
      if (res.status === 401 || body.status === "sign_in_required") {
        setAccountState((current) => ({
          userId: requestUserId,
          accountRevision: requestProviderAccountRevision,
          wanteds: [],
          fetchStatus: "sign_in",
          fulfilNote: current?.userId === requestUserId ? current.fulfilNote : null,
        }));
        return;
      }
      const door = res.ok ? readContributionDoor(body) : undefined;
      if (door) {
        setAccountState((current) => ({
          userId: requestUserId,
          accountRevision: requestProviderAccountRevision,
          wanteds: [],
          fetchStatus: "gated",
          door,
          fulfilNote: current?.userId === requestUserId ? current.fulfilNote : null,
        }));
        return;
      }
      if (!res.ok) {
        setAccountState((current) => ({
          userId: requestUserId,
          accountRevision: requestProviderAccountRevision,
          wanteds: current?.userId === requestUserId ? current.wanteds : [],
          fetchStatus: "error",
          fulfilNote: current?.userId === requestUserId ? current.fulfilNote : null,
        }));
        return;
      }
      setAccountState((current) => ({
        userId: requestUserId,
        accountRevision: requestProviderAccountRevision,
        wanteds: Array.isArray(body.wanteds) ? body.wanteds : [],
        fetchStatus: "ready",
        fulfilNote: current?.userId === requestUserId ? current.fulfilNote : null,
      }));
    } catch {
      if (!isCurrentRequest() || requestRevision.current !== revision) {
        return;
      }
      setAccountState((current) => ({
        userId: requestUserId,
        accountRevision: requestProviderAccountRevision,
        wanteds: current?.userId === requestUserId ? current.wanteds : [],
        fetchStatus: "error",
        fulfilNote: current?.userId === requestUserId ? current.fulfilNote : null,
      }));
    }
  }, [accountRevision, getCurrentUserId, supabaseAuthState, userId]);

  useEffect(() => {
    // The only reason to ask is an account to ask for.
    if (!userId) return;
    const requestedUserId = userId;
    const requestedAccountRevision = accountRevision;
    void Promise.resolve().then(() => {
      if (
        getCurrentUserId() !== requestedUserId ||
        activeUserId.current !== requestedUserId ||
        activeAccountRevision.current !== requestedAccountRevision
      ) return;
      void refresh();
    });
  }, [accountRevision, getCurrentUserId, refresh, userId]);

  const providerAccountRevision = readProviderAccountRevision();
  const currentAccountState =
    accountState !== null &&
    accountState.accountRevision === providerAccountRevision &&
    accountState.userId === userId &&
    (userId !== null || supabaseAuthState === "unresolved")
      ? accountState
      : null;
  const fulfilNote = currentAccountState?.fulfilNote ?? null;

  const handleSaved = useCallback(
    (wanted: WantedDTO) => {
      if (userId === null) {
        if (supabaseAuthState !== "unresolved" && supabaseAuthState !== "unavailable") return;
        setAnonymousWanteds((current) => [wanted, ...current.filter((row) => row.id !== wanted.id)]);
        return;
      }
      if (readProviderAccountRevision() !== providerAccountRevision) return;
      if (activeUserId.current !== userId) return;
      setAccountState((current) => ({
        userId,
        accountRevision: providerAccountRevision,
        wanteds: [
          wanted,
          ...(current?.userId === userId && current.accountRevision === providerAccountRevision
            ? current.wanteds.filter((row) => row.id !== wanted.id)
            : []),
        ],
        fetchStatus: "ready",
        fulfilNote:
          current?.userId === userId && current.accountRevision === providerAccountRevision
            ? current.fulfilNote
            : null,
      }));
    },
    [providerAccountRevision, supabaseAuthState, userId],
  );
  // The owner changed or removed a row they saved. Same guards as a save: the
  // answer lands only if it is still the account that asked.
  const handleChanged = useCallback(
    (wanted: WantedDTO) => {
      if (!userId || readProviderAccountRevision() !== providerAccountRevision) return;
      if (activeUserId.current !== userId) return;
      setAccountState((current) =>
        current?.userId === userId && current.accountRevision === providerAccountRevision
          ? {
              ...current,
              wanteds: current.wanteds.map((row) => (row.id === wanted.id ? wanted : row)),
            }
          : current,
      );
    },
    [providerAccountRevision, userId],
  );
  const handleRemoved = useCallback(
    (id: string) => {
      if (!userId || readProviderAccountRevision() !== providerAccountRevision) return;
      if (activeUserId.current !== userId) return;
      setAccountState((current) =>
        current?.userId === userId && current.accountRevision === providerAccountRevision
          ? { ...current, wanteds: current.wanteds.filter((row) => row.id !== id) }
          : current,
      );
    },
    [providerAccountRevision, userId],
  );
  const handleFulfilNote = useCallback(
    (note: string | null, eventUserId?: string | null) => {
      if (
        !userId ||
        eventUserId !== userId ||
        activeUserId.current !== userId ||
        getCurrentUserId() !== userId
      ) return;
      setAccountState((current) => ({
        userId,
        accountRevision: providerAccountRevision,
        wanteds: current?.userId === userId ? current.wanteds : [],
        fetchStatus: current?.userId === userId ? current.fetchStatus : "loading",
        fulfilNote: note,
      }));
    },
    [getCurrentUserId, providerAccountRevision, userId],
  );
  const handleFulfilRefresh = useCallback((eventUserId?: string | null) => {
    if (
      !userId ||
      eventUserId !== userId ||
      activeUserId.current !== userId ||
      getCurrentUserId() !== userId
    ) return;
    void refresh();
  }, [getCurrentUserId, refresh, userId]);

  // What the session says is DERIVED, never stored: a signed-out answer is not
  // a fetch result, and writing it into state would both cascade a render and
  // leave the previous account's rows to be un-set afterwards. Deriving means
  // a sign-out hides them in the same paint, which is the law
  // __tests__/wantedPlanChipsAuth.test.ts already holds for the plan chips.
  const loadStatus =
    viewerSession.signedOut
      ? "sign_in"
      : !viewerSession.signedIn || !userId
        ? "loading"
        : currentAccountState?.fetchStatus ?? "loading";
  const owned = currentAccountState?.wanteds ?? [];
  const door = loadStatus === "gated" ? currentAccountState?.door : undefined;

  const open = owned.filter((row) => row.status === "open");
  const fulfilled = owned.filter((row) => row.status === "fulfilled");
  const anonymousOpen = anonymousWanteds.filter((row) => row.status === "open");

  return (
    <>
      {loadStatus === "sign_in" ? (
        <p className="wantedPanel__empty">Sign in to keep a Wanted list.</p>
      ) : door ? (
        <ContributionGateDoor
          status={door}
          subject="keep a Wanted list"
          onAsserted={() => void refresh()}
        />
      ) : (
        <WantedCapture
          key={userId ?? "no-account"}
          anonymous={userId === null && (supabaseAuthState === "unresolved" || supabaseAuthState === "unavailable")}
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

      {loadStatus === "ready" && open.length === 0 && anonymousOpen.length === 0 ? (
        <p className="wantedPanel__empty">No open Wanted places yet.</p>
      ) : null}

      {open.length > 0 ? (
        <WantedOpenList wanteds={open} onChanged={handleChanged} onRemoved={handleRemoved} />
      ) : null}
      {anonymousOpen.length > 0 ? <WantedOpenList anonymous wanteds={anonymousOpen} /> : null}

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
    </>
  );
}

function WantedOpenList({
  anonymous = false,
  wanteds,
  onChanged,
  onRemoved,
}: {
  anonymous?: boolean;
  wanteds: WantedDTO[];
  onChanged?: (wanted: WantedDTO) => void;
  onRemoved?: (id: string) => void;
}): React.JSX.Element {
  return (
    <ul className="wantedList" aria-label={anonymous ? "Anonymous open Wanted places" : "Open Wanted places"}>
      {wanteds.map((wanted) => {
        const href = mapUrlFor(wanted);
        const promotable = !anonymous && (isWantedPromotable(wanted) || Boolean(wanted.promotedListType));
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
                  ? "UK pub · no pint price on record"
                  : wanted.venueKind === "pending"
                    ? "Still matching"
                    : "On the priced map"}
                {wanted.sourceUrl ? " · source link saved" : ""}
                {wanted.note ? ` · ${wanted.note}` : ""}
              </p>
            </div>
            {!anonymous && onChanged && onRemoved ? (
              <WantedRowManage wanted={wanted} onChanged={onChanged} onRemoved={onRemoved} />
            ) : null}
            {href || promotable ? (
              <div className="wantedRow__actions">
                {href ? (
                  <a className="wantedRow__map" href={href}>
                    Open map
                  </a>
                ) : null}
                {promotable ? (
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
