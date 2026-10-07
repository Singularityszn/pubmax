"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { discardBody } from "@/lib/responseBody";
import { safeLocalStorage } from "@/lib/safeStorage";
import {
  cleanListType,
  fetchSavedForHandle,
  getSaved,
  toggleSaveDurable,
  type SavedPubDTO,
} from "@/lib/savedPubs";
import {
  eligibleBuiltInListTypes,
  isListTypeEligibleForVenue,
} from "@/lib/savedListPolicy";
import type { VenueKind } from "@/lib/venues";

import "./saveToList.css";
import { authedActionFetch, authedFetch } from "@/lib/authedFetch";

// Save-a-venue-to-a-list control with CUSTOM LIST support (story 33). A small,
// self-contained island: it shows the eligible built-in lists PLUS the viewer's
// own custom lists, lets them file a venue under any of them, and lets them
// create a new named list inline.
// Identity is the self-asserted `pubmax_handle` (no auth yet); a signed-out viewer
// still gets the built-in localStorage save via toggleSaveDurable's fallback, but
// custom lists need a handle to persist server-side.

const HANDLE_KEY = "pubmax_handle";

function readHandle(): string {
  return (safeLocalStorage()?.getItem(HANDLE_KEY) ?? "").trim();
}

/** With no handle the save lives in this browser only, so the line says so. */
function savedToast(listType: string, handle: string): string {
  return handle.trim()
    ? `Saved to "${listType}"`
    : `Saved to "${listType}" on this device`;
}

/** The lists this venue is in right now, from the server's fresh answer when
 * there is one and this device's own store when there is not. */
function listsHolding(venueId: string, durable: readonly SavedPubDTO[] | null): string[] {
  const rows = durable ?? getSaved();
  return rows.filter((row) => row.venueId === venueId).map((row) => row.listType);
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
  const [handle] = useState(readHandle);
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
  const [toast, setToast] = useState<string | null>(null);
  // WHICH LISTS HOLD THIS PUB. A chip is a switch, so it has to say which way it
  // is set: pressing it a second time removes the save, and a chip that looked
  // the same either way took the pub off a list with no sign it had.
  const [savedIn, setSavedIn] = useState<string[]>(() => listsHolding(venueId, null));
  // The inspector reuses this control as it moves from pub to pub, so the
  // membership it holds belongs to ONE venue. A new venue starts from this
  // device's own answer for it (adjust-state-during-render, the repo idiom),
  // never from the pub before: a signed-out reader has no server read to fix it.
  const [membershipVenueId, setMembershipVenueId] = useState(venueId);
  if (membershipVenueId !== venueId) {
    setMembershipVenueId(venueId);
    setSavedIn(listsHolding(venueId, null));
    setToast(null);
  }
  // Which membership read may still land. A press (or a venue change) bumps it,
  // so an answer that was asked before the press cannot overwrite the newer one.
  const membershipRead = useRef(0);
  // The pub on screen now, for the writes: a save that was still in flight when
  // the inspector moved on must not paint its answer on the next pub.
  const currentVenue = useRef(venueId);
  useEffect(() => {
    // Another pub: whatever was asked for the last one must not land on this one.
    membershipRead.current += 1;
    currentVenue.current = venueId;
  }, [venueId]);

  // Load the handle's custom lists lazily when the picker opens (cheap GET,
  // fail-soft to just the built-ins).
  const loadLists = useCallback(async () => {
    const h = handle.trim();
    if (!h) return;
    const read = ++membershipRead.current;
    try {
      const res = await authedFetch(
        `/api/saved-pubs?handle=${encodeURIComponent(h)}&lists=1`,
        {},
        { requiresIdentity: true },
      );
      if (res.ok) {
        const body = (await res.json()) as { lists?: string[] };
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
    if (durable && membershipRead.current === read) {
      setSavedIn(listsHolding(venueId, durable));
    }
  }, [handle, venueId]);

  useEffect(() => {
    // Defer through a promise callback so setState never runs synchronously in
    // the effect body (react-hooks/set-state-in-effect).
    if (open) void Promise.resolve().then(() => loadLists());
  }, [open, loadLists]);

  const announce = useCallback((forVenue: string, listType: string, held: string[]) => {
    if (currentVenue.current !== forVenue) return;
    setSavedIn(held);
    setToast(
      held.includes(listType) ? savedToast(listType, handle) : `Removed from “${listType}”`,
    );
    window.setTimeout(() => setToast(null), 2000);
  }, [handle]);

  const save = useCallback(
    async (listType: string) => {
      membershipRead.current += 1;
      setBusy(true);
      try {
        const durable = await toggleSaveDurable(handle, venueId, listType, undefined, venueKind);
        // The second press removes the save, so the toast says which happened.
        announce(venueId, listType, listsHolding(venueId, durable));
      } finally {
        setBusy(false);
      }
    },
    [handle, venueId, venueKind, announce],
  );

  const createAndSave = useCallback(async () => {
    const name = cleanListType(newName);
    if (!name || busy) return;
    membershipRead.current += 1;
    if (!isListTypeEligibleForVenue(name, venueKind)) {
      setToast("Pint lists are for pubs");
      window.setTimeout(() => setToast(null), 2000);
      return;
    }
    setBusy(true);
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
            if (Array.isArray(body.lists)) setCustomLists(body.lists);
          }
        } catch {
          /* the save below still works even if the registry write failed */
        }
      }
      // The save is a toggle, so a name that already holds this pub is left as
      // it is rather than pressed a second time.
      const held = savedIn.includes(name)
        ? savedIn
        : listsHolding(
            venueId,
            await toggleSaveDurable(handle, venueId, name, undefined, venueKind),
          );
      setNewName("");
      announce(venueId, name, held);
    } finally {
      setBusy(false);
    }
  }, [handle, venueId, venueKind, newName, busy, savedIn, announce]);

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
            disabled={busy}
          >
            {name}
          </button>
        ))}
      </div>

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
          disabled={busy || !newName.trim()}
        >
          Create &amp; save
        </button>
      </div>

      {toast ? (
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
