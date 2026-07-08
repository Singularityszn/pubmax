"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { getAnonId } from "@/lib/anonId";
import type { PintDropDTO } from "@/lib/feed";
import {
  buildOptimisticSpillDrop,
  buildOptimisticSpillRetryPayload,
  emitOptimisticSpillChange,
  failOptimisticSpill,
  newOptimisticSpillClientId,
  readOptimisticSpills,
  reconcileOptimisticSpill,
  shouldOptimisticallyAppearInFeed,
  upsertOptimisticSpill,
  writeOptimisticSpills,
} from "@/lib/optimisticSpillPost";
import { clearPintDropDraft } from "@/lib/pintDropDraft";
import type { PintDrop, VibeTag } from "@/lib/pintDropShared";
import { appendWithSuffix, DEFAULT_VISIBILITY, type Visibility } from "@/lib/spill";

// The API DTO carries photo URLs on every drop; lib/pintDrops owns the base
// shape, so we augment it here at the client boundary rather than editing lib/*.
export type DropWithPhotos = PintDrop & {
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  optimistic?: PintDropDTO["optimistic"];
};

export type PhotoSlot = { file: File; previewUrl: string };
export type PhotoSlotName = "pint" | "venue";

/** Success/error banner after a drop — optional next-action links for Loop 2. */
export type DropMsg = {
  ok: boolean;
  text: string;
  links?: Array<{ href: string; label: string }>;
};

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB — server re-validates.
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_VIBE_TAGS = 4; // mirrors the server cap in lib/pintDrops.ts.
const ACTIVE_ROUND_KEY = "pubmax_active_round";

/** Read the active Round code stamped by /rounds/[code] (Loop 2 stickiness). */
function readActiveRoundCode(): string {
  if (typeof window === "undefined") return "";
  try {
    return (window.localStorage.getItem(ACTIVE_ROUND_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * Best-effort: append this venue as a stop on the open Round. Fail-soft — a
 * miss (closed / network) must never undo a successful drop. Joins first so a
 * viewer who stamped the Round from the page can append without a separate
 * join step, then uses the existing `addStop` action.
 */
async function appendStopToActiveRound(input: {
  code: string;
  handle: string;
  venueId: string;
  venueName: string;
  dropRef?: string;
}): Promise<boolean> {
  try {
    const joinRes = await fetch(`/api/rounds/${encodeURIComponent(input.code)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", handle: input.handle }),
    });
    // Join may 409 if closed — still attempt addStop only on ok (idempotent join).
    if (!joinRes.ok && joinRes.status !== 409) {
      // Non-member / not found — don't pretend the stop landed.
      // 409 closed is handled by addStop below returning false.
    }
    const res = await fetch(`/api/rounds/${encodeURIComponent(input.code)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "addStop",
        handle: input.handle,
        venueId: input.venueId,
        venueName: input.venueName,
        ...(input.dropRef ? { dropRef: input.dropRef } : {}),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function groupDropsByVenueId(drops: DropWithPhotos[]): Map<string, DropWithPhotos[]> {
  const grouped = new Map<string, DropWithPhotos[]>();
  for (const drop of drops) {
    grouped.set(drop.venueId, [...(grouped.get(drop.venueId) ?? []), drop]);
  }
  return grouped;
}

// Owns all client-side /api/pint-drops interaction: fetch, per-venue refresh,
// submit (multipart), report, composer form + photo slot state. API contract unchanged.
export function usePintDrops() {
  const [handle, setHandle] = useState(() =>
    typeof window === "undefined" ? "" : (window.localStorage.getItem("pubmax_handle") ?? ""),
  );
  const [dropsByVenueId, setDropsByVenueId] = useState<Map<string, DropWithPhotos[]>>(
    () => new Map(),
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const [dropForm, setDropForm] = useState({ price: "", drink: "", note: "", era: "", withWho: "" });
  // Visibility (issue #29 backbone; this composer is the first writer of it).
  // Additive field — defaults to `public`, matching the server default exactly.
  const [visibility, setVisibility] = useState<Visibility>(DEFAULT_VISIBILITY);
  // Selected vibe tags (client-side UX only — the server re-filters against its
  // own allowlist). Multi-select, capped at MAX_VIBE_TAGS by toggleVibeTag.
  const [vibeTags, setVibeTags] = useState<VibeTag[]>([]);
  const [pintPhoto, setPintPhoto] = useState<PhotoSlot | null>(null);
  const [venuePhoto, setVenuePhoto] = useState<PhotoSlot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dropMsg, setDropMsg] = useState<DropMsg | null>(null);
  const pintInputRef = useRef<HTMLInputElement>(null);
  const venueInputRef = useRef<HTMLInputElement>(null);
  // Ref guard + optimistic removal is the whole "pending state" for reports —
  // the button unmounts on click, so double-submit can't happen.
  const reportsInFlight = useRef(new Set<string>());

  // Refresh the WHOLE drops layer from the public list (all venues). This is the
  // same read the initial load uses — so #29 visibility filtering re-applies —
  // and re-groups by venue, which repaints every pin halo / venue signal. Live
  // updates (issue #37, useLiveDrops) call this on a new-drop signal. Fail-soft:
  // a failed refresh leaves the current layer intact (does NOT wipe it), so a
  // transient hiccup never blanks the map.
  const refreshAllDrops = useCallback(() => {
    fetch("/api/pint-drops")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("bad status"))))
      .then((data: { drops?: DropWithPhotos[] }) =>
        setDropsByVenueId(groupDropsByVenueId(data.drops ?? [])),
      )
      .catch(() => {
        // Keep the existing layer — a live refresh failure is not a reason to
        // blank the map (unlike the initial load, which has nothing to preserve).
      });
  }, []);

  useEffect(() => {
    fetch("/api/pint-drops")
      .then((response) => (response.ok ? response.json() : { drops: [] }))
      .then((data: { drops?: DropWithPhotos[] }) =>
        setDropsByVenueId(groupDropsByVenueId(data.drops ?? [])),
      )
      .catch(() => setDropsByVenueId(new Map()));
  }, []);

  // Refresh one venue's drops; returns a cancel function for effect cleanup.
  const refreshVenueDrops = useCallback((venueId: string) => {
    let active = true;
    fetch(`/api/pint-drops?venueId=${encodeURIComponent(venueId)}`)
      .then((response) => (response.ok ? response.json() : { drops: [] }))
      .then((data: { drops?: DropWithPhotos[] }) => {
        if (active) {
          setDropsByVenueId((current) => {
            const next = new Map(current);
            next.set(venueId, data.drops ?? []);
            return next;
          });
        }
      })
      .catch(() => {
        if (active) {
          setDropsByVenueId((current) => {
            const next = new Map(current);
            next.set(venueId, []);
            return next;
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Pick a photo for one slot: pre-validate (type + size) before we ever build a
  // preview or submit, so bad files are caught client-side. Object URLs are
  // revoked when the slot is replaced/removed and on unmount (effect below).
  function pickPhoto(slot: PhotoSlotName, file: File | undefined, inputEl: HTMLInputElement | null) {
    const current = slot === "pint" ? pintPhoto : venuePhoto;
    const setSlot = slot === "pint" ? setPintPhoto : setVenuePhoto;
    if (!file) return;
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setDropMsg({ ok: false, text: "Photos must be JPEG, PNG, or WebP." });
      if (inputEl) inputEl.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setDropMsg({ ok: false, text: "Each photo must be under 5MB." });
      if (inputEl) inputEl.value = "";
      return;
    }
    if (current) URL.revokeObjectURL(current.previewUrl);
    setDropMsg(null);
    setSlot({ file, previewUrl: URL.createObjectURL(file) });
  }

  // Toggle a vibe tag on/off. Multi-select, but silently ignores a new
  // selection once MAX_VIBE_TAGS is reached (the server caps identically).
  function toggleVibeTag(tag: VibeTag) {
    setVibeTags((current) =>
      current.includes(tag)
        ? current.filter((t) => t !== tag)
        : current.length >= MAX_VIBE_TAGS
          ? current
          : [...current, tag],
    );
  }

  function removePhoto(slot: PhotoSlotName) {
    const current = slot === "pint" ? pintPhoto : venuePhoto;
    const setSlot = slot === "pint" ? setPintPhoto : setVenuePhoto;
    const inputEl = slot === "pint" ? pintInputRef.current : venueInputRef.current;
    if (current) URL.revokeObjectURL(current.previewUrl);
    setSlot(null);
    if (inputEl) inputEl.value = "";
  }

  const resetComposer = useCallback(() => {
    setPintPhoto((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setVenuePhoto((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setDropForm({ price: "", drink: "", note: "", era: "", withWho: "" });
    setVibeTags([]);
    setVisibility(DEFAULT_VISIBILITY);
    if (pintInputRef.current) pintInputRef.current.value = "";
    if (venueInputRef.current) venueInputRef.current.value = "";
  }, []);

  // Revoke any live preview URLs when the component unmounts.
  useEffect(() => {
    return () => {
      if (pintPhoto) URL.revokeObjectURL(pintPhoto.previewUrl);
      if (venuePhoto) URL.revokeObjectURL(venuePhoto.previewUrl);
    };
  }, [pintPhoto, venuePhoto]);

  function updateOptimisticFeedStorage(
    update: (current: ReturnType<typeof readOptimisticSpills>) => ReturnType<typeof readOptimisticSpills>,
  ) {
    if (typeof window === "undefined") return;
    const next = update(readOptimisticSpills(window.localStorage));
    writeOptimisticSpills(window.localStorage, next);
    emitOptimisticSpillChange();
  }

  async function submitDrop(event: FormEvent, venueId: string, options?: { venueName?: string }) {
    event.preventDefault();
    setSubmitting(true);
    setDropMsg(null);
    const clientRequestId = newOptimisticSpillClientId();
    const passedDownNote = appendWithSuffix(dropForm.note, dropForm.withWho);
    const optimisticInput = {
      clientRequestId,
      venueId,
      venueName: options?.venueName,
      handle,
      priceGbp: dropForm.price,
      drink: dropForm.drink,
      passedDownNote,
      era: dropForm.era,
      visibility,
      vibeTags,
      pintPhotoUrl: pintPhoto?.previewUrl ?? null,
      venuePhotoUrl: venuePhoto?.previewUrl ?? null,
      createdAt: new Date().toISOString(),
    };
    const optimisticDrop = buildOptimisticSpillDrop(optimisticInput);
    const publishToFeed = shouldOptimisticallyAppearInFeed(visibility);
    if (publishToFeed) {
      updateOptimisticFeedStorage((current) =>
        upsertOptimisticSpill(
          current,
          optimisticDrop,
          buildOptimisticSpillRetryPayload(optimisticInput),
        ),
      );
    }
    const optimisticMapDrop: DropWithPhotos = {
      id: optimisticDrop.id,
      venueId,
      handle: optimisticDrop.handle,
      drink: optimisticDrop.drink,
      priceGbp: optimisticDrop.priceGbp,
      passedDownNote: optimisticDrop.passedDownNote,
      era: optimisticDrop.era,
      vibeTags: optimisticDrop.vibeTags as VibeTag[],
      provenance: optimisticDrop.provenance,
      status: "visible",
      visibility,
      createdAt: optimisticDrop.createdAt,
      pintPhotoUrl: optimisticDrop.pintPhotoUrl,
      venuePhotoUrl: optimisticDrop.venuePhotoUrl,
      optimistic: optimisticDrop.optimistic,
    };
    setDropsByVenueId((current) => {
      const next = new Map(current);
      next.set(venueId, [optimisticMapDrop, ...(next.get(venueId) ?? [])]);
      return next;
    });

    const markFailed = (message: string) => {
      if (publishToFeed) {
        updateOptimisticFeedStorage((current) => failOptimisticSpill(current, clientRequestId, message));
      }
      setDropsByVenueId((current) => {
        const next = new Map(current);
        next.set(
          venueId,
          (next.get(venueId) ?? []).map((drop) =>
            drop.id === optimisticDrop.id
              ? {
                  ...drop,
                  optimistic: {
                    state: "failed",
                    message,
                    uploadProgress: null,
                    canRetry: true,
                    clientRequestId,
                  },
                }
              : drop,
          ),
        );
        return next;
      });
    };

    try {
      // multipart/form-data — do NOT set Content-Type, the browser adds the boundary.
      const body = new FormData();
      body.set("venueId", venueId);
      body.set("handle", handle);
      body.set("drink", dropForm.drink);
      body.set("priceGbp", dropForm.price);
      // "With" has no server column (frozen API contract) — folded into the
      // note as a structured suffix ("— with @sam, @priya") at submit time, so
      // every surface that renders passedDownNote gets it for free. See
      // lib/spill.ts for the exact format.
      body.set("passedDownNote", passedDownNote);
      body.set("era", dropForm.era);
      body.set("visibility", visibility);
      // Repeated field entries — the route also accepts one comma-separated
      // value; the server re-filters against its allowlist either way.
      for (const tag of vibeTags) body.append("vibe_tags", tag);
      if (pintPhoto) body.set("pint_photo", pintPhoto.file);
      if (venuePhoto) body.set("venue_photo", venuePhoto.file);

      const response = await fetch("/api/pint-drops", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) {
        const message = data.error ?? "Could not save that drop.";
        markFailed(message);
        setDropMsg({ ok: false, text: message });
      } else {
        const reconciledDrop = {
          ...(data.drop as PintDropDTO),
          venueName: options?.venueName,
          venueMapUrl: `/map?sel=${encodeURIComponent(venueId)}`,
        };
        if (publishToFeed) {
          updateOptimisticFeedStorage((current) =>
            reconcileOptimisticSpill(current, clientRequestId, reconciledDrop),
          );
        }
        setDropsByVenueId((current) => {
          const next = new Map(current);
          next.set(venueId, [
            data.drop,
            ...(next.get(venueId) ?? []).filter((drop) => drop.id !== optimisticDrop.id),
          ]);
          return next;
        });
        clearPintDropDraft(
          typeof window === "undefined" ? null : window.sessionStorage,
          venueId,
        );
        try {
          window.localStorage.setItem("pubmax_handle", handle.trim());
        } catch {
          // A successful Pint Drop should not become a failed post because
          // browser storage is blocked/full. The handle can be re-entered later.
        }

        // Loop 2: if a Round is open, append this pub as a stop (existing
        // addStop API). Fail-soft — the drop already landed.
        const activeRound = readActiveRoundCode();
        const dropId =
          data.drop && typeof data.drop === "object" && typeof (data.drop as { id?: unknown }).id === "string"
            ? (data.drop as { id: string }).id
            : undefined;
        let addedToNight = false;
        if (activeRound && handle.trim()) {
          addedToNight = await appendStopToActiveRound({
            code: activeRound,
            handle: handle.trim(),
            venueId,
            venueName: options?.venueName ?? "A London pub",
            dropRef: dropId,
          });
        }

        resetComposer();
        setComposerOpen(false);
        // Post-drop "added to your night" moment — tasteful next actions, not a modal.
        const links: NonNullable<DropMsg["links"]> = [
          { href: "/feed", label: "See the feed" },
        ];
        if (activeRound || addedToNight) {
          links.push({
            href: `/bar-tab/${encodeURIComponent(venueId)}`,
            label: "Bar tab",
          });
          const cleanHandle = handle.trim().replace(/^@+/, "");
          if (cleanHandle) {
            links.push({ href: `/u/${encodeURIComponent(cleanHandle)}`, label: "Your profile" });
          }
        }
        setDropMsg({
          ok: true,
          text:
            activeRound || addedToNight
              ? "Cheers — added to your night."
              : "Cheers — your Pint Drop is live.",
          links,
        });
      }
    } catch {
      const message = "Network or storage error — try again.";
      markFailed(message);
      setDropMsg({ ok: false, text: message });
    } finally {
      setSubmitting(false);
    }
  }

  async function reportDrop(venueId: string, id: string) {
    if (reportsInFlight.current.has(id)) return;
    reportsInFlight.current.add(id);
    // Optimistic remove — moderation is minimal, no reason UI.
    setDropsByVenueId((current) => {
      const next = new Map(current);
      next.set(venueId, (next.get(venueId) ?? []).filter((drop) => drop.id !== id));
      return next;
    });
    setDropMsg({ ok: true, text: "Report received — that Pint Drop is hidden." });
    try {
      // `actor` is the device's stable anon id (same attribution reactions and
      // comments use) — the server hashes it into the per-actor report key, so
      // devices behind a shared IP (pub wifi / NAT) stay distinct actors.
      // Called from an event handler, so `window` exists; getAnonId() returns
      // "" when storage is unavailable and the server degrades to its shared
      // anon sentinel.
      await fetch("/api/pint-drops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "report", id, actor: getAnonId() }),
      });
    } catch {
      // Swallow — the drop is already hidden locally; a failed report just
      // means it reappears on next load, which is acceptable for demo moderation.
    }
  }

  // Reset composer chrome when the inspected venue changes.
  const closeComposer = useCallback(() => {
    setDropMsg(null);
    setComposerOpen(false);
  }, []);

  const venueSignals = useMemo(() => {
    const signals = new Map<
      string,
      { hasPintDrops: boolean; dropCount: number; latestContributorPrice: number | null }
    >();
    for (const [venueId, venueDrops] of dropsByVenueId) {
      // Demo seeds never feed the "latest contributor price" signal — a seeded
      // price must not read as a community log.
      const latestContributorPrice =
        venueDrops.find(
          (drop) => drop.provenance !== "demo" && typeof drop.priceGbp === "number",
        )?.priceGbp ?? null;
      // dropCount/hasPintDrops match the map halo: any visible drop counts
      // (seeds included) so the "has drops" signal is consistent everywhere.
      signals.set(venueId, {
        hasPintDrops: venueDrops.length > 0,
        dropCount: venueDrops.length,
        latestContributorPrice,
      });
    }
    return signals;
  }, [dropsByVenueId]);

  return {
    dropsByVenueId,
    venueSignals,
    refreshVenueDrops,
    refreshAllDrops,
    handle,
    setHandle,
    composerOpen,
    setComposerOpen,
    closeComposer,
    dropForm,
    setDropForm,
    vibeTags,
    setVibeTags,
    toggleVibeTag,
    visibility,
    setVisibility,
    pintPhoto,
    venuePhoto,
    pintInputRef,
    venueInputRef,
    pickPhoto,
    removePhoto,
    resetComposer,
    submitting,
    dropMsg,
    submitDrop,
    reportDrop,
  };
}

export type PintDropsState = ReturnType<typeof usePintDrops>;
