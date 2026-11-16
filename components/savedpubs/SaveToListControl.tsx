"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/authContext";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { discardBody } from "@/lib/responseBody";
import {
  cleanListType,
  fetchSavedForHandle,
  getSaved,
  readCanonicalSaved,
  toggleSaveDurable,
  type SavedPub,
  type SavedPubDTO,
} from "@/lib/savedPubs";
import {
  eligibleBuiltInListTypes,
  isListTypeEligibleForVenue,
} from "@/lib/savedListPolicy";
import type { VenueKind } from "@/lib/venues";

import "./saveToList.css";
import { authedActionFetch, authedFetch } from "@/lib/authedFetch";
import NearbyVisitCheckIn from "@/components/savedpubs/NearbyVisitCheckIn";
import { BEEN_HERE_LIST } from "@/lib/beenHere";

// Save-a-venue-to-a-list control with CUSTOM LIST support (story 33). A small,
// self-contained island: it shows the eligible built-in lists PLUS the viewer's
// own custom lists, lets them file a venue under any of them, and lets them
// create a new named list inline.
// The handle is the viewer's own (useViewerHandle). Until the viewer's identity
// has resolved, nothing is written anywhere: the picker holds its chips and says
// it is checking. A settled viewer with no handle saves in localStorage via
// toggleSaveDurable's fallback, but custom lists need a handle to persist
// server-side.

/** How long the identity check may run before the picker offers a retry. */
const IDENTITY_PENDING_GRACE_MS = 4_000;

/** With no handle the save lives in this browser only, so the line says so. */
function savedToast(listType: string, handle: string): string {
  return handle.trim()
    ? `Saved to "${listType}"`
    : `Saved to "${listType}" on this device`;
}

/** The lists this venue is in right now, from the server's fresh answer when
 * there is one and this device's own store when there is not. */
function listsHolding(
  venueId: string,
  read: readonly Pick<SavedPub, "venueId" | "listType">[] | null,
): string[] {
  const rows = read ?? getSaved();
  return rows.filter((row) => row.venueId === venueId).map((row) => row.listType);
}

/** The lists holding this pub after a press of `listType` that asked for
 * `wanted`, or null when the press cannot be confirmed. A signed-out press has
 * only this device's store to answer it. A signed-in press is judged against
 * the server's own state before it, so it is confirmed only by a server answer
 * that moved that way (the route answers a failed write with the list as it
 * was), and then it moves this one chip, never the others. */
function afterPress(
  signedIn: boolean,
  savedIn: readonly string[],
  venueId: string,
  listType: string,
  wanted: boolean,
  durable: readonly SavedPubDTO[] | null,
  local: readonly SavedPub[],
): string[] | null {
  if (!signedIn) return listsHolding(venueId, local);
  if (!durable) return null;
  const held = durable.some((row) => row.venueId === venueId && row.listType === listType);
  if (held !== wanted) return null;
  const others = savedIn.filter((name) => name !== listType);
  return wanted ? [...others, listType] : others;
}

export default function SaveToListControl({
  venueId,
  venueName,
  venueKind,
  open: openProp,
  onOpenChange,
}: {
  venueId: string;
  venueName?: string;
  venueKind?: VenueKind;
  /** Lets the host keep one prompt open at a time. Left out, the control owns
   *  its own open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}): React.JSX.Element {
  const { user, identityResolved, retryIdentity } = useAuth();
  const handle = useViewerHandle() ?? "";
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const [customLists, setCustomLists] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const activeMutation = useRef<{ read: number } | null>(null);
  const [membershipRefresh, setMembershipRefresh] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showToast = useCallback((message: string, duration?: number) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    if (duration !== undefined) toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);
  // WHICH LISTS HOLD THIS PUB. A chip is a switch, so it has to say which way it
  // is set: pressing it a second time removes the save, and a chip that looked
  // the same either way took the pub off a list with no sign it had.
  const [savedIn, setSavedIn] = useState<string[]>(() => listsHolding(venueId, null));
  // For a handle, a press is judged against what the SERVER held before it, so
  // the chips wait until the server's membership for this pub has landed. This
  // device's copy may be missing a save made elsewhere, and a press judged
  // against it would report a removal that worked as a failure.
  const [serverVenueId, setServerVenueId] = useState<string | null>(null);
  const ready = identityResolved && serverVenueId === venueId;
  // The inspector reuses this control as it moves from pub to pub, so the
  // membership it holds belongs to ONE venue. A new venue starts from this
  // device's own answer for it (adjust-state-during-render, the repo idiom),
  // never from the pub before: a signed-out reader has no server read to fix it.
  const [membershipVenueId, setMembershipVenueId] = useState(venueId);
  if (membershipVenueId !== venueId) {
    setMembershipVenueId(venueId);
    setSavedIn(listsHolding(venueId, null));
    setServerVenueId(null);
    setToast(null);
  }
  // An in-place account switch leaves this control mounted (and its picker
  // open). Its membership and list registry belong to the identity that was
  // read, so another account, or its handle landing, starts from this device's
  // answer, and the server read for it runs again.
  const accountKey = `${user?.id ?? ""}\n${handle}`;
  useEffect(() => () => clearTimeout(toastTimer.current), [venueId, accountKey]);
  const [membershipAccountKey, setMembershipAccountKey] = useState(accountKey);
  if (membershipAccountKey !== accountKey) {
    setMembershipAccountKey(accountKey);
    setSavedIn(listsHolding(venueId, null));
    setCustomLists([]);
    setServerVenueId(null);
    setToast(null);
  }
  // Which membership read may still land. A press (or a venue change) bumps it,
  // so an answer that was asked before the press cannot overwrite the newer one.
  const membershipRead = useRef(0);
  useEffect(() => {
    // Another pub: whatever was asked for the last one must not land on this one.
    membershipRead.current += 1;
  }, [venueId]);
  useEffect(() => {
    // Another account: nor may an answer that was asked for the last one.
    membershipRead.current += 1;
  }, [accountKey]);

  // Load the handle's custom lists lazily when the picker opens (cheap GET,
  // fail-soft to just the built-ins).
  const loadLists = useCallback(async () => {
    if (activeMutation.current) return;
    const h = handle.trim();
    const read = ++membershipRead.current;
    if (!h) {
      const local = await readCanonicalSaved();
      if (membershipRead.current !== read) return;
      setSavedIn(listsHolding(venueId, local));
      setServerVenueId(venueId);
      return;
    }
    try {
      const res = await authedFetch(
        `/api/saved-pubs?handle=${encodeURIComponent(h)}&lists=1`,
        {},
        { requiresIdentity: true },
      );
      if (res.ok) {
        const body = (await res.json()) as { lists?: string[] };
        if (membershipRead.current !== read) return;
        setCustomLists(Array.isArray(body.lists) ? body.lists : []);
      } else {
        discardBody(res);
      }
    } catch {
      // Offline / error — the built-ins are always available regardless.
    }
    // What the server holds for this pub wins over this device's copy. It is
    // asked whether or not the list registry answered, and its answer is
    // dropped if a press or another venue came first.
    const durable = await fetchSavedForHandle(h);
    if (membershipRead.current !== read) return;
    if (durable) {
      setSavedIn(listsHolding(venueId, durable));
      setServerVenueId(venueId);
    } else {
      showToast("Could not load your lists. Close and open again.");
    }
  }, [handle, venueId, showToast]);

  useEffect(() => {
    // Defer through a promise callback so setState never runs synchronously in
    // the effect body (react-hooks/set-state-in-effect).
    if (open) void Promise.resolve().then(() => loadLists());
  }, [open, loadLists, accountKey, membershipRefresh]);

  const announce = useCallback((listType: string, held: string[] | null) => {
    if (held) setSavedIn(held);
    showToast(
      !held
        ? "Could not confirm that just now."
        : held.includes(listType)
          ? savedToast(listType, handle)
          : `Removed from "${listType}"`,
      2000,
    );
  }, [handle, showToast]);

  const beginMutation = useCallback(() => {
    if (activeMutation.current || busy || !ready) return null;
    const mutation = { read: ++membershipRead.current };
    activeMutation.current = mutation;
    setBusy(true);
    return mutation;
  }, [busy, ready]);

  const finishMutation = useCallback((mutation: { read: number }, refresh = false) => {
    if (activeMutation.current !== mutation) return false;
    const current = membershipRead.current === mutation.read;
    activeMutation.current = null;
    membershipRead.current += 1;
    if (refresh || !current) {
      setServerVenueId(null);
      setMembershipRefresh((version) => version + 1);
    }
    setBusy(false);
    return current;
  }, []);

  const beginNearbyCheckIn = useCallback(() => {
    const mutation = beginMutation();
    if (!mutation) return null;
    return (saved: boolean) => {
      if (!finishMutation(mutation, !saved)) return false;
      if (saved) setSavedIn((held) => held.includes(BEEN_HERE_LIST) ? held : [...held, BEEN_HERE_LIST]);
      return true;
    };
  }, [beginMutation, finishMutation]);

  const save = useCallback(
    async (listType: string) => {
      const mutation = beginMutation();
      if (!mutation) return;
      try {
        const wanted = !savedIn.includes(listType);
        const durable = await toggleSaveDurable(handle, venueId, listType, undefined, venueKind, wanted);
        const local = handle ? [] : await readCanonicalSaved();
        if (!finishMutation(mutation)) return;
        // The second press removes the save, so the toast says which happened.
        announce(
          listType,
          afterPress(
            Boolean(handle),
            savedIn,
            venueId,
            listType,
            wanted,
            durable,
            local,
          ),
        );
      } finally {
        finishMutation(mutation);
      }
    },
    [handle, venueId, venueKind, beginMutation, finishMutation, savedIn, announce],
  );

  const createAndSave = useCallback(async () => {
    const name = cleanListType(newName);
    if (!name) return;
    if (!isListTypeEligibleForVenue(name, venueKind)) {
      showToast("Pint lists are for pubs", 2000);
      return;
    }
    const mutation = beginMutation();
    if (!mutation) return;
    try {
      const h = handle.trim();
      // Register the custom list (best-effort) then file the venue under it.
      if (h) {
        try {
          const res = await authedActionFetch("/api/saved-pubs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ handle: h, action: "createList", name }),
          }, { requiresIdentity: true });
          if (res.ok) {
            const body = (await res.json()) as { lists?: string[] };
            if (activeMutation.current === mutation && membershipRead.current === mutation.read && Array.isArray(body.lists)) setCustomLists(body.lists);
          }
        } catch {
          /* the save below still works even if the registry write failed */
        }
      }
      if (activeMutation.current !== mutation || membershipRead.current !== mutation.read) return;
      // A name that already holds this pub is left as it is rather than pressed
      // a second time.
      const held = savedIn.includes(name)
        ? savedIn
        : afterPress(
            Boolean(handle),
            savedIn,
            venueId,
            name,
            true,
            await toggleSaveDurable(handle, venueId, name, undefined, venueKind),
            handle ? [] : await readCanonicalSaved(),
          );
      if (!finishMutation(mutation)) return;
      setNewName("");
      announce(name, held);
    } finally {
      finishMutation(mutation);
    }
  }, [handle, venueId, venueKind, newName, beginMutation, finishMutation, showToast, savedIn, announce]);

  if (!open) {
    return (
      <button type="button" className="saveToListToggle" onClick={() => setOpen(true)}>
        Save{venueName ? ` ${venueName}` : ""} to a list
      </button>
    );
  }

  const allLists = [...eligibleBuiltInListTypes(venueKind), ...customLists];

  return (
    <section className="saveToList" aria-label="Save this venue to a list">
      <div className="saveToListChips">
        {allLists.map((name) => (
          <button
            key={name}
            type="button"
            className="saveToListChip"
            aria-pressed={savedIn.includes(name)}
            onClick={() => void save(name)}
            disabled={busy || !ready}
          >
            {name}
          </button>
        ))}
      </div>

      {user && handle && allLists.includes(BEEN_HERE_LIST) ? (
        <NearbyVisitCheckIn
          key={`${accountKey}:${venueId}`}
          venueId={venueId}
          handle={handle}
          disabled={busy || !ready}
          onStart={beginNearbyCheckIn}
        />
      ) : null}

      <div className="saveToListNew">
        <input
          type="text"
          value={newName}
          maxLength={60}
          placeholder="New list name"
          aria-label="New list name"
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          className="saveToListCreate"
          onClick={() => void createAndSave()}
          disabled={busy || !ready || !newName.trim()}
        >
          Create &amp; save
        </button>
      </div>

      {!identityResolved ? (
        <IdentityPendingLine onRetry={user ? retryIdentity : null} />
      ) : toast ? (
        <p className="saveToListToast" role="status">
          {toast}
        </p>
      ) : null}

      <button type="button" className="saveToListClose" onClick={() => setOpen(false)}>
        Close
      </button>
    </section>
  );
}

// A failed identity read leaves the account unknown until something reads it
// again, so after a few seconds the wait offers that read. Mounted only while
// waiting, so every wait starts quiet.
function IdentityPendingLine({ onRetry }: { onRetry: (() => void) | null }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (slow) return;
    const timer = window.setTimeout(() => setSlow(true), IDENTITY_PENDING_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [slow]);

  return (
    <p className="saveToListToast" role="status">
      Checking your account.
      {slow && onRetry ? (
        <>
          {" "}
          <button
            type="button"
            className="saveToListRetry"
            onClick={() => {
              setSlow(false);
              onRetry();
            }}
          >
            Try again
          </button>
        </>
      ) : null}
    </p>
  );
}
