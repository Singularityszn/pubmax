"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { PintDrop, VibeTag } from "@/lib/pintDrops";

// The API DTO carries photo URLs on every drop; lib/pintDrops owns the base
// shape, so we augment it here at the client boundary rather than editing lib/*.
export type DropWithPhotos = PintDrop & {
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
};

export type PhotoSlot = { file: File; previewUrl: string };
export type PhotoSlotName = "pint" | "venue";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB — server re-validates.
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_VIBE_TAGS = 4; // mirrors the server cap in lib/pintDrops.ts.

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
  const [dropForm, setDropForm] = useState({ price: "", drink: "", note: "", era: "" });
  // Selected vibe tags (client-side UX only — the server re-filters against its
  // own allowlist). Multi-select, capped at MAX_VIBE_TAGS by toggleVibeTag.
  const [vibeTags, setVibeTags] = useState<VibeTag[]>([]);
  const [pintPhoto, setPintPhoto] = useState<PhotoSlot | null>(null);
  const [venuePhoto, setVenuePhoto] = useState<PhotoSlot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dropMsg, setDropMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pintInputRef = useRef<HTMLInputElement>(null);
  const venueInputRef = useRef<HTMLInputElement>(null);
  // ponytail: ref guard + optimistic removal is the whole "pending state" for
  // reports — the button unmounts on click, so double-submit can't happen.
  const reportsInFlight = useRef(new Set<string>());

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

  function resetComposer() {
    if (pintPhoto) URL.revokeObjectURL(pintPhoto.previewUrl);
    if (venuePhoto) URL.revokeObjectURL(venuePhoto.previewUrl);
    setPintPhoto(null);
    setVenuePhoto(null);
    setDropForm({ price: "", drink: "", note: "", era: "" });
    setVibeTags([]);
    if (pintInputRef.current) pintInputRef.current.value = "";
    if (venueInputRef.current) venueInputRef.current.value = "";
  }

  // Revoke any live preview URLs when the component unmounts.
  useEffect(() => {
    return () => {
      if (pintPhoto) URL.revokeObjectURL(pintPhoto.previewUrl);
      if (venuePhoto) URL.revokeObjectURL(venuePhoto.previewUrl);
    };
  }, [pintPhoto, venuePhoto]);

  async function submitDrop(event: FormEvent, venueId: string) {
    event.preventDefault();
    setSubmitting(true);
    setDropMsg(null);
    try {
      // multipart/form-data — do NOT set Content-Type, the browser adds the boundary.
      const body = new FormData();
      body.set("venueId", venueId);
      body.set("handle", handle);
      body.set("drink", dropForm.drink);
      body.set("priceGbp", dropForm.price);
      body.set("passedDownNote", dropForm.note);
      body.set("era", dropForm.era);
      // Repeated field entries — the route also accepts one comma-separated
      // value; the server re-filters against its allowlist either way.
      for (const tag of vibeTags) body.append("vibe_tags", tag);
      if (pintPhoto) body.set("pint_photo", pintPhoto.file);
      if (venuePhoto) body.set("venue_photo", venuePhoto.file);

      const response = await fetch("/api/pint-drops", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) {
        setDropMsg({ ok: false, text: data.error ?? "Could not save that drop." });
      } else {
        window.localStorage.setItem("pubmax_handle", handle.trim());
        setDropsByVenueId((current) => {
          const next = new Map(current);
          next.set(venueId, [data.drop, ...(next.get(venueId) ?? [])]);
          return next;
        });
        resetComposer();
        setComposerOpen(false);
        setDropMsg({ ok: true, text: "Cheers — your Pint Drop is live." });
      }
    } catch {
      setDropMsg({ ok: false, text: "Network or storage error — try again." });
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
      await fetch("/api/pint-drops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "report", id }),
      });
    } catch {
      // ponytail: swallow — the drop is already hidden locally; a failed report
      // just means it reappears on next load, which is acceptable for demo moderation.
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
    handle,
    setHandle,
    composerOpen,
    setComposerOpen,
    closeComposer,
    dropForm,
    setDropForm,
    vibeTags,
    toggleVibeTag,
    pintPhoto,
    venuePhoto,
    pintInputRef,
    venueInputRef,
    pickPhoto,
    removePhoto,
    submitting,
    dropMsg,
    submitDrop,
    reportDrop,
  };
}

export type PintDropsState = ReturnType<typeof usePintDrops>;
