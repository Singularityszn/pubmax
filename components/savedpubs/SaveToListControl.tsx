"use client";

import { useCallback, useEffect, useState } from "react";

import { BUILT_IN_LIST_TYPES, toggleSaveDurable } from "@/lib/savedPubs";

import "./saveToList.css";

// Save-a-pub-to-a-list control with CUSTOM LIST support (story 33). A small,
// self-contained island: it shows the seven built-in lists PLUS the viewer's own
// custom lists, lets them file a pub under any of them, and lets them create a
// new named list inline. Decoupled from the Venue type — it takes only a venueId
// + a name for the toast — so it can be dropped anywhere a pub is in view.
//
// INTEGRATOR MOUNT POINT (one line): render this next to the existing save button
// inside the venue inspector, e.g.
//     <SaveToListControl venueId={venue.id} venueName={venue.name} />
// (VenueInspector is owned by another agent — this component is standalone so no
// edit to that file is required beyond the single mount line.)
//
// Identity is the self-asserted `pubmax_handle` (no auth yet); a signed-out viewer
// still gets the built-in localStorage save via toggleSaveDurable's fallback, but
// custom lists need a handle to persist server-side.

const HANDLE_KEY = "pubmax_handle";

function readHandle(): string {
  if (typeof window === "undefined") return "";
  return (window.localStorage.getItem(HANDLE_KEY) ?? "").trim();
}

export default function SaveToListControl({
  venueId,
  venueName,
}: {
  venueId: string;
  venueName?: string;
}): React.JSX.Element {
  const [handle] = useState(readHandle);
  const [open, setOpen] = useState(false);
  const [customLists, setCustomLists] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Load the handle's custom lists lazily when the picker opens (cheap GET,
  // fail-soft to just the built-ins).
  const loadLists = useCallback(async () => {
    const h = handle.trim();
    if (!h) return;
    try {
      const res = await fetch(`/api/saved-pubs?handle=${encodeURIComponent(h)}&lists=1`);
      if (!res.ok) return;
      const body = (await res.json()) as { lists?: string[] };
      setCustomLists(Array.isArray(body.lists) ? body.lists : []);
    } catch {
      // Offline / error — the built-ins are always available regardless.
    }
  }, [handle]);

  useEffect(() => {
    // Defer through a promise callback so setState never runs synchronously in
    // the effect body (react-hooks/set-state-in-effect).
    if (open) void Promise.resolve().then(() => loadLists());
  }, [open, loadLists]);

  const save = useCallback(
    async (listType: string) => {
      setBusy(true);
      try {
        await toggleSaveDurable(handle, venueId, listType);
        setToast(`Saved to “${listType}”`);
        window.setTimeout(() => setToast(null), 2000);
      } finally {
        setBusy(false);
      }
    },
    [handle, venueId],
  );

  const createAndSave = useCallback(async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const h = handle.trim();
      // Register the custom list (best-effort) then file the pub under it.
      if (h) {
        try {
          const res = await fetch("/api/saved-pubs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ handle: h, action: "createList", name }),
          });
          if (res.ok) {
            const body = (await res.json()) as { lists?: string[] };
            if (Array.isArray(body.lists)) setCustomLists(body.lists);
          }
        } catch {
          /* the save below still works even if the registry write failed */
        }
      }
      await toggleSaveDurable(handle, venueId, name);
      setNewName("");
      setToast(`Saved to “${name}”`);
      window.setTimeout(() => setToast(null), 2000);
    } finally {
      setBusy(false);
    }
  }, [handle, venueId, newName, busy]);

  if (!open) {
    return (
      <button type="button" className="saveToListToggle" onClick={() => setOpen(true)}>
        Save{venueName ? ` ${venueName}` : ""} to a list
      </button>
    );
  }

  const allLists = [...BUILT_IN_LIST_TYPES, ...customLists];

  return (
    <section className="saveToList" aria-label="Save this pub to a list">
      <div className="saveToListChips">
        {allLists.map((name) => (
          <button
            key={name}
            type="button"
            className="saveToListChip"
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
