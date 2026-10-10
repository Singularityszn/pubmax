"use client";

import type { Route } from "next";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/authContext";
import { barTabPath, profilePath } from "@/lib/appLink";
import { readActiveRoundCode } from "@/lib/activeRound";
import { getAnonId } from "@/lib/anonId";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { trackEvent } from "@/lib/analytics";
import type { CityId } from "@/lib/cities";
import { unresolvedVenueLabel } from "@/lib/cityVenueIds";
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
import { lastTrainComposeFields } from "@/lib/lastTrainBadge";
import {
  filterMapPintDropEntries,
  type MapPintDropVenue,
} from "@/lib/mapPintDropPolicy";
import {
  confirmationOutcomeLine,
  parseConfirmationOutcome,
  type PintDropConfirmationOutcome,
} from "@/lib/pintDropSecondDrinker";
import type { ConfirmedPriceInput } from "@/lib/priceTier";
import {
  venueDropsAfterRead,
  type VenueDropRead,
  type VenueDropReadStatus,
} from "@/lib/venueDropRead";
import { clearPintDropDraft } from "@/lib/pintDropDraft";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";
import { pintDropAuthorValue } from "@/lib/pintDropComposerIdentity";
import { notifyCheapPintPingQualified } from "@/lib/cheapPintPingQualifyClient";
import type { PintDrop, VibeTag } from "@/lib/pintDropShared";
import {
  captureRoundAppendSnapshot,
  captureRoundRequestIdentity,
  roundJsonRequest,
  runRoundMutationForCurrentUser,
  type RoundAppendSnapshot,
  type RoundRequestIdentity,
} from "@/lib/roundRequest";
import { DEFAULT_DRINK_MEASURE, type DrinkMeasure } from "@/lib/drinkMeasure";
import {
  appendWithSuffix,
  DEFAULT_VISIBILITY,
  spillHasSubmissionEvidence,
  type Visibility,
} from "@/lib/spill";
import type { LastPintDecision } from "@/lib/tfl";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { PintPriceSplit } from "@/lib/pintDropAgreement";
import { RECEIPT_REQUIRED_LINE, photoRefusal, priceNeedsReceipt } from "@/lib/pintDropReceipt";
import { pintTrustFor, pintTrustSignalFields, type PintTrustState } from "@/lib/pintTrust";

// The API DTO carries photo URLs on every drop; lib/pintDrops owns the base
// shape, so we augment it here at the client boundary rather than editing lib/*.
export type DropWithPhotos = PintDrop & {
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  /** The bill behind this price, or null (captain 7 Sept 2026). Absent on every
   *  drop written before migration 0153, and on every drop with no price. */
  receiptPhotoUrl?: string | null;
  optimistic?: PintDropDTO["optimistic"];
};

/** Re-exported from its owner so a surface can take it from either door. */
export type { VenueDropReadStatus } from "@/lib/venueDropRead";

export type PhotoSlot = { file: File; previewUrl: string };
/**
 * THREE SLOTS since 7 Sept 2026. `pint` is what they drank, `venue` is where,
 * and `receipt` is the photo of the bill a new price now carries
 * (lib/pintDropReceipt.ts). Three names rather than a reused one, because the
 * drop's own row prints them apart and only one of them is required.
 */
export type PhotoSlotName = "pint" | "venue" | "receipt";

/** Success/error banner after a drop — optional next-action links for Loop 2. */
export type DropMsg = {
  ok: boolean;
  text: string;
  links?: Array<{ href: Route; label: string }>;
};

// ONE NUMBER ON BOTH SIDES OF THE WIRE, and ONE PLACE THAT ASKS. This gate
// said 5 MB while the platform refuses any body over 4.5 MB with a plain-text
// 413 before a handler runs, so a 4.5 MB phone photo passed the check the
// browser made and came back as "Could not save that drop." with nothing about
// its size (PlanAstra, section 2.4). `photoRefusal` (lib/pintDropReceipt.ts) is
// the browser's whole half of that rule, quoting lib/uploadBodyLimit.ts's own
// figure, and both composers ask it rather than each keeping a copy.
const MAX_VIBE_TAGS = 4; // mirrors the server cap in lib/pintDrops.ts.

/**
 * Best-effort: append this venue as a stop on the open Round. Fail-soft — a
 * miss (closed / network) must never undo a successful drop. Joins first so a
 * viewer who stamped the Round from the page can append without a separate
 * join step, then uses the existing `addStop` action.
 */
async function appendStopToActiveRound(input: {
  identity: RoundRequestIdentity;
  code: string;
  handle: string;
  venueId: string;
  venueName: string;
  dropRef?: string;
}): Promise<boolean> {
  try {
    const path = `/api/rounds/${encodeURIComponent(input.code)}`;
    const joinRes = await roundJsonRequest(path, input.identity, {
      action: "join",
      handle: input.handle,
    });
    // Join may 409 if already a member — still attempt addStop (idempotent join).
    // Other join failures must not call addStop or pretend the stop landed.
    if (!joinRes.ok && joinRes.status !== 409) {
      return false;
    }
    const res = await roundJsonRequest(
      path,
      input.identity,
      {
        action: "addStop",
        handle: input.handle,
        venueId: input.venueId,
        venueName: input.venueName,
        ...(input.dropRef ? { dropRef: input.dropRef } : {}),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

function pintDropId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

async function appendPintDropStopToActiveRound(input: {
  round: RoundAppendSnapshot | null;
  currentUserId: () => string | null;
  venueId: string;
  venueName: string;
  dropRef?: string;
}): Promise<boolean> {
  const round = input.round;
  if (!round) return false;
  const completion = await runRoundMutationForCurrentUser(
    round.identity,
    input.currentUserId,
    () =>
      appendStopToActiveRound({
        identity: round.identity,
        code: round.code,
        handle: round.handle,
        venueId: input.venueId,
        venueName: input.venueName,
        dropRef: input.dropRef,
      }),
  );
  return completion.current && completion.value;
}

/**
 * The measure fields a write carries, from the composer's own form.
 *
 * Module scope on purpose. The submit path is already at ESLint's complexity
 * ceiling, and the label rule (only an `other` measure carries one) is one
 * decision that three call sites need: the optimistic row, the request body
 * and the receipt. Deciding it once here keeps all three in step and leaves
 * the branch out of the handler.
 */
function measureFieldsOf(form: {
  measure: DrinkMeasure;
  measureLabel: string;
}): { measure: DrinkMeasure; measureLabel: string } {
  return {
    measure: form.measure,
    measureLabel: form.measure === "other" ? form.measureLabel.trim() : "",
  };
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
// `cityId` scopes the unscoped map-layer fetch so Manchester demo seeds colour
// Manchester pins without leaking into the London feed.
/**
 * The receipt under a landed drop: the line it always printed, plus the one
 * sentence the second-reporter pass earned it (lib/pintDropSecondDrinker.ts),
 * so a drinker who just repeated their own report is told so here rather than
 * left reading "needs a second drinker" over the figure they sent.
 */
function rereadLaneOnMint(
  outcome: PintDropConfirmationOutcome | null,
  reread: () => void,
): void {
  if (outcome?.status === "confirmed") reread();
}

function dropReceiptText(
  addedToNight: boolean,
  outcome: PintDropConfirmationOutcome | null,
  submittedPrice: string,
): string {
  const receipt = addedToNight
    ? "Cheers. Added to your night."
    : "Cheers. Your Pint Drop is live.";
  const submittedGbp = Number(submittedPrice);
  const outcomeLine = confirmationOutcomeLine(
    outcome,
    Number.isFinite(submittedGbp) ? submittedGbp : null,
  );
  return outcomeLine ? `${receipt} ${outcomeLine}` : receipt;
}

export function usePintDrops(
  cityId: CityId = "london",
  mapVenues?: readonly MapPintDropVenue[],
  /**
   * #1462 — the figure the log intent arrived carrying, or null. It is a SEED
   * for the price field and nothing more: `useVenueDraft` is the ONE owner of
   * what a venue's composer holds, so the seed is handed to that hydration
   * rather than written over it. A saved draft outranks it, because a draft is
   * the drinker's own unfinished work and the seed is only a door's opening
   * offer.
   */
  priceSeed: string | null = null,
) {
  const {
    user,
    session,
    loading: authLoading,
    configured: authConfigured,
    handle: accountHandle,
    identityResolved,
    getCurrentUserId,
  } = useAuth();
  const signedIn = Boolean(user && session);
  const identityReady = !authLoading && identityResolved;
  const roundIdentity = useMemo(
    () =>
      authLoading
        ? null
        : captureRoundRequestIdentity(user?.id ?? null, session),
    [authLoading, session, user?.id],
  );
  const [handle, setHandle] = useState(() =>
    safeLocalStorage()?.getItem("pubmax_handle") ?? "",
  );
  // WHERE EACH PER-VENUE DROP READ GOT TO (review finding F-8). Same three-way
  // shape as `venuePriceStatus` in useCommunityPrices: a surface may only word a
  // pub as having no drops once its own read ANSWERED. An absent entry is
  // `idle`, which is honestly "not asked yet".
  const [venueDropStatus, setVenueDropStatus] = useState<
    Map<string, VenueDropReadStatus>
  >(() => new Map());
  const venueDropRequests = useRef(new Map<string, symbol>());
  const [dropsByVenueId, setDropsByVenueId] = useState<Map<string, DropWithPhotos[]>>(
    () => new Map(),
  );
  const [composerOpen, setComposerOpen] = useState(false);
  // The second drinker's door (lib/pintDropSecondDrinker.ts). "Still £4.50?"
  // on the venue sheet seeds the composer with the figure the pub's lane
  // already prints, through the SAME hydration the log intent's `price=`
  // rides, so a saved draft still outranks it and nothing here submits. The
  // URL seed wins when both are present, because a door the reader arrived
  // through is the older promise.
  const [confirmSeed, setConfirmSeed] = useState<string | null>(null);
  const seedComposerPrice = useCallback((price: string | null) => {
    setConfirmSeed(price);
  }, []);
  const [dropForm, setDropForm] = useState({
    price: "",
    drink: "",
    // The SERVING the price is about (battle test D04). Defaults to the
    // measure the pint lane already assumed, so the composer opens on the
    // ordinary case and a half is one tap away rather than a free-text hope.
    measure: DEFAULT_DRINK_MEASURE as DrinkMeasure,
    measureLabel: "",
    note: "",
    era: "",
    withWho: "",
  });
  // Visibility (issue #29 backbone; this composer is the first writer of it).
  // Additive field — defaults to `public`, matching the server default exactly.
  const [visibility, setVisibility] = useState<Visibility>(DEFAULT_VISIBILITY);
  // Selected vibe tags (client-side UX only — the server re-filters against its
  // own allowlist). Multi-select, capped at MAX_VIBE_TAGS by toggleVibeTag.
  const [vibeTags, setVibeTags] = useState<VibeTag[]>([]);
  const [pintPhoto, setPintPhoto] = useState<PhotoSlot | null>(null);
  const [venuePhoto, setVenuePhoto] = useState<PhotoSlot | null>(null);
  const [receiptPhoto, setReceiptPhoto] = useState<PhotoSlot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dropMsg, setDropMsg] = useState<DropMsg | null>(null);
  const pintInputRef = useRef<HTMLInputElement>(null);
  const venueInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  // Ref guard + optimistic removal is the whole "pending state" for reports —
  // the button unmounts on click, so double-submit can't happen.
  const reportsInFlight = useRef(new Set<string>());
  // Abort in-flight city-scoped list fetches when city changes or a newer
  // refresh supersedes an older one (avoids stale London drops painting Manchester).
  const cityListAbortRef = useRef<AbortController | null>(null);

  // Refresh the WHOLE drops layer from the public list (city-scoped). This is
  // the same read the initial load uses — so #29 visibility filtering re-applies —
  // and re-groups by venue, which repaints every pin halo / venue signal. Live
  // updates (issue #37, useLiveDrops) call this on a new-drop signal. Fail-soft:
  // a failed refresh leaves the current layer intact (does NOT wipe it), so a
  // transient hiccup never blanks the map.
  const refreshAllDrops = useCallback(() => {
    cityListAbortRef.current?.abort();
    const ac = new AbortController();
    cityListAbortRef.current = ac;
    const qs = new URLSearchParams({ city: cityId });
    fetch(`/api/pint-drops?${qs.toString()}`, { signal: ac.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("bad status"))))
      .then((data: { drops?: DropWithPhotos[] }) => {
        if (!ac.signal.aborted) {
          setDropsByVenueId(groupDropsByVenueId(data.drops ?? []));
        }
      })
      .catch(() => {
        // Keep the existing layer — a live refresh failure / abort is not a
        // reason to blank the map (unlike the initial load).
      });
  }, [cityId]);

  useEffect(() => {
    cityListAbortRef.current?.abort();
    const ac = new AbortController();
    cityListAbortRef.current = ac;
    const qs = new URLSearchParams({ city: cityId });
    fetch(`/api/pint-drops?${qs.toString()}`, { signal: ac.signal })
      .then((response) => (response.ok ? response.json() : { drops: [] }))
      .then((data: { drops?: DropWithPhotos[] }) => {
        if (!ac.signal.aborted) {
          setDropsByVenueId(groupDropsByVenueId(data.drops ?? []));
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setDropsByVenueId(new Map());
      });
    return () => ac.abort();
  }, [cityId]);

  // Refresh one venue's drops; returns a cancel function for effect cleanup.
  //
  // A FAILED READ IS A FACT ABOUT US, NEVER ABOUT THE PUB (review finding F-8).
  // This used to write `[]` into the venue's entry on a non-ok response and on a
  // rejection alike. `/api/pint-drops` answers 503 whenever its store read
  // throws, so one hiccup replaced a pub's real drops with nothing:
  // `pintTrustFor([])` reads `none` and the Overview printed the first-drop
  // nudge over a pub holding a confirmed price - the exact sentence #1495 exists
  // to keep off a public drop. The city refresh above already keeps its layer on
  // a failure; this now does the same, and records the read so a surface can
  // tell "we could not look" from "nobody has logged one".
  const refreshVenueDrops = useCallback((venueId: string) => {
    const request = Symbol();
    venueDropRequests.current.set(venueId, request);
    setVenueDropStatus((current) => {
      const next = new Map(current);
      next.set(venueId, "idle");
      return next;
    });
    // ONE RULE for both outcomes (lib/venueDropRead.ts), so the failure path
    // cannot quietly grow a second answer.
    const settle = (read: VenueDropRead<DropWithPhotos>) => {
      if (venueDropRequests.current.get(venueId) !== request) return;
      venueDropRequests.current.delete(venueId);
      setDropsByVenueId((current) => {
        const held = current.get(venueId);
        const kept = venueDropsAfterRead(held, read);
        if (kept === held) return current;
        const next = new Map(current);
        next.set(venueId, kept as DropWithPhotos[]);
        return next;
      });
      setVenueDropStatus((current) => {
        const next = new Map(current);
        next.set(venueId, read.status);
        return next;
      });
    };
    fetch(`/api/pint-drops?venueId=${encodeURIComponent(venueId)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("bad status"))))
      .then((data: { drops?: DropWithPhotos[] }) => {
        settle({ status: "ready", drops: data.drops ?? [] });
      })
      .catch(() => settle({ status: "unavailable" }));
    return () => {
      if (venueDropRequests.current.get(venueId) === request) {
        venueDropRequests.current.delete(venueId);
      }
    };
  }, []);

  // Pick a photo for one slot: pre-validate (type + size) before we ever build a
  // preview or submit, so bad files are caught client-side. Object URLs are
  // revoked when the slot is replaced/removed and on unmount (effect below).
  // ONE TABLE FOR THREE SLOTS. It was a pair of ternaries per function, and a
  // third slot would have made six places to keep in step.
  const photoSlots = {
    pint: { value: pintPhoto, set: setPintPhoto, input: pintInputRef },
    venue: { value: venuePhoto, set: setVenuePhoto, input: venueInputRef },
    receipt: { value: receiptPhoto, set: setReceiptPhoto, input: receiptInputRef },
  } as const;

  function pickPhoto(slot: PhotoSlotName, file: File | undefined, inputEl: HTMLInputElement | null) {
    const current = photoSlots[slot].value;
    const setSlot = photoSlots[slot].set;
    if (!file) return;
    const refusal = photoRefusal(file);
    if (refusal) {
      setDropMsg({ ok: false, text: refusal });
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
    const current = photoSlots[slot].value;
    const setSlot = photoSlots[slot].set;
    const inputEl = photoSlots[slot].input.current;
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
    setReceiptPhoto((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setDropForm({
      price: "",
      drink: "",
      measure: DEFAULT_DRINK_MEASURE,
      measureLabel: "",
      note: "",
      era: "",
      withWho: "",
    });
    setVibeTags([]);
    setVisibility(DEFAULT_VISIBILITY);
    if (pintInputRef.current) pintInputRef.current.value = "";
    if (venueInputRef.current) venueInputRef.current.value = "";
    if (receiptInputRef.current) receiptInputRef.current.value = "";
  }, []);

  // Revoke any live preview URLs when the component unmounts.
  useEffect(() => {
    return () => {
      if (pintPhoto) URL.revokeObjectURL(pintPhoto.previewUrl);
      if (venuePhoto) URL.revokeObjectURL(venuePhoto.previewUrl);
      if (receiptPhoto) URL.revokeObjectURL(receiptPhoto.previewUrl);
    };
  }, [pintPhoto, venuePhoto, receiptPhoto]);

  function updateOptimisticFeedStorage(
    update: (current: ReturnType<typeof readOptimisticSpills>) => ReturnType<typeof readOptimisticSpills>,
  ) {
    const storage = safeLocalStorage();
    if (!storage) return;
    const next = update(readOptimisticSpills(storage));
    writeOptimisticSpills(storage, next);
    emitOptimisticSpillChange();
  }

  function submitDrop(
    event: FormEvent,
    venueId: string,
    options?: { venueName?: string; lastTrainDecision?: LastPintDecision | null },
  ) {
    event.preventDefault();
    if (
      !spillHasSubmissionEvidence({
        price: dropForm.price,
        note: dropForm.note,
        withWho: dropForm.withWho,
      })
    ) {
      setDropMsg({ ok: false, text: "Add a price or a passed-down note." });
      return;
    }
    return submitDropRequest(venueId, options);
  }

  async function submitDropRequest(
    venueId: string,
    options?: { venueName?: string; lastTrainDecision?: LastPintDecision | null },
  ) {
    const submittedRound = captureRoundAppendSnapshot(
      roundIdentity,
      accountHandle,
      readActiveRoundCode(),
      safeLocalStorage(),
    );
    setSubmitting(true);
    setDropMsg(null);
    const clientRequestId = newOptimisticSpillClientId();
    const submittedAuthor = pintDropAuthorValue({
      accountHandle,
      draftHandle: handle,
      signedIn,
      identityReady,
      authRequired: authConfigured,
    });
    if (!submittedAuthor.canSubmit) {
      setSubmitting(false);
      setDropMsg({
        ok: false,
        text:
          authConfigured && !signedIn
            ? "Sign in to post a Pint Drop."
            : "Finish setting your PUBMAXX handle before posting.",
      });
      return;
    }
    // A NEW PRICE COMES WITH THE BILL (captain 7 Sept 2026). Said here as well
    // as at the route, so a drinker learns it before the upload rather than
    // after it (lib/pintDropReceipt.ts owns the rule and the line).
    if (priceNeedsReceipt(dropForm.price) && !receiptPhoto) {
      setSubmitting(false);
      setDropMsg({ ok: false, text: RECEIPT_REQUIRED_LINE });
      return;
    }
    const passedDownNote = appendWithSuffix(dropForm.note, dropForm.withWho);
    // Wave G1: only stamp leave-by + decision when a LIVE Last Pint verdict is
    // on screen — never attach live_data_unavailable or a missing leave-by.
    const trainFields = lastTrainComposeFields(options?.lastTrainDecision ?? null);
    const optimisticInput = {
      clientRequestId,
      venueId,
      venueName: options?.venueName,
      handle: submittedAuthor.handle,
      priceGbp: dropForm.price,
      drink: dropForm.drink,
      passedDownNote,
      era: dropForm.era,
      visibility,
      vibeTags,
      pintPhotoUrl: pintPhoto?.previewUrl ?? null,
      venuePhotoUrl: venuePhoto?.previewUrl ?? null,
      createdAt: new Date().toISOString(),
      ...(trainFields ?? {}),
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
      // The optimistic row carries its measure too, so a half never
      // flashes through the pint lane between the tap and the answer.
      ...measureFieldsOf(dropForm),
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
      // The bill shows on the row the moment it is posted, from the same local
      // preview the other two use, so the drinker sees their own evidence
      // before the upload lands.
      receiptPhotoUrl: receiptPhoto?.previewUrl ?? null,
      optimistic: optimisticDrop.optimistic,
      ...(trainFields
        ? { leaveByIso: trainFields.leaveByIso, lastTrainDecision: trainFields.lastTrainDecision }
        : {}),
    };
    setDropsByVenueId((current) => {
      const next = new Map(current);
      next.set(venueId, [optimisticMapDrop, ...(next.get(venueId) ?? [])]);
      return next;
    });

    // Instant post UX (IDEAS A2): close the composer immediately and reconcile
    // in the background. Failures keep the optimistic card in a retryable state.
    // Capture form fields BEFORE resetComposer clears them.
    const submittedHandle = submittedAuthor.handle.trim();
    const submittedDrink = dropForm.drink;
    const submittedPrice = dropForm.price;
    const submittedMeasure = measureFieldsOf(dropForm);
    const submittedEra = dropForm.era;
    const submittedVisibility = visibility;
    const submittedVibeTags = [...vibeTags];
    const submittedPintFile = pintPhoto?.file ?? null;
    const submittedVenueFile = venuePhoto?.file ?? null;
    const submittedReceiptFile = receiptPhoto?.file ?? null;
    clearPintDropDraft(safeSessionStorage(), venueId);
    const local = safeLocalStorage();
    if (local) {
      try {
        local.setItem("pubmax_handle", submittedHandle);
      } catch {
        // Storage blocked — handle can be re-entered later.
      }
    }
    resetComposer();
    setComposerOpen(false);
    setSubmitting(false);
    setDropMsg({
      ok: true,
      text: "Cheers. Saving your Pint Drop…",
      links: [{ href: "/social", label: "Open Social" }],
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
      setDropMsg({ ok: false, text: message });
    };

    try {
      // multipart/form-data — do NOT set Content-Type, the browser adds the boundary.
      const body = new FormData();
      body.set("venueId", venueId);
      body.set("handle", submittedHandle);
      body.set("drink", submittedDrink);
      // The SERVING the price is about (battle test D04). Always sent, so
      // the server never has to infer a measure from the drink text.
      body.set("measure", submittedMeasure.measure);
      body.set("measureLabel", submittedMeasure.measureLabel);
      body.set("priceGbp", submittedPrice);
      // "With" has no server column (frozen API contract) — folded into the
      // note as a structured suffix ("— with @sam, @priya") at submit time, so
      // every surface that renders passedDownNote gets it for free. See
      // lib/spill.ts for the exact format.
      body.set("passedDownNote", passedDownNote);
      body.set("era", submittedEra);
      body.set("visibility", submittedVisibility);
      // Repeated field entries — the route also accepts one comma-separated
      // value; the server re-filters against its allowlist either way.
      for (const tag of submittedVibeTags) body.append("vibe_tags", tag);
      if (trainFields) {
        body.set("leaveByIso", trainFields.leaveByIso);
        body.set("lastTrainDecision", trainFields.lastTrainDecision);
      }
      if (submittedPintFile) body.set("pint_photo", submittedPintFile);
      if (submittedVenueFile) body.set("venue_photo", submittedVenueFile);
      if (submittedReceiptFile) body.set("receipt_photo", submittedReceiptFile);

      const response = await authedActionFetch("/api/pint-drops", { method: "POST", body }, { requiresIdentity: true });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        markFailed(errorMessageFrom(data, "Could not save that drop."));
        return;
      }
      trackEvent("night_moment_saved", { kind: "pint_drop", visibility: submittedVisibility });
      notifyCheapPintPingQualified();

      const reconciledDrop = {
        ...(data.drop as PintDropDTO),
        venueName: options?.venueName,
        venueMapUrl: venueMapUrl(venueId),
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

      // Loop 2: if a Round is open, append this pub as a stop (existing
      // addStop API). Fail-soft — the drop already landed.
      const addedToNight = await appendPintDropStopToActiveRound({
        round: submittedRound,
        currentUserId: getCurrentUserId,
        venueId,
        venueName: options?.venueName ?? unresolvedVenueLabel(venueId),
        dropRef: pintDropId(data.drop),
      });

      const links: NonNullable<DropMsg["links"]> = [
        { href: "/social", label: "Open Social" },
      ];
      if (addedToNight) {
        links.push({
          href: barTabPath(venueId),
          label: "Bar tab",
        });
        const cleanHandle = submittedRound?.handle.replace(/^@+/, "") ?? "";
        if (cleanHandle) {
          links.push({ href: profilePath(cleanHandle), label: "Your profile" });
        }
      }
      // What the second-reporter pass answered. A mint changes the standing of
      // BOTH rows of the pair, and the row this browser holds for the earlier
      // report predates it, so the lane is re-read rather than patched by hand.
      const outcome = parseConfirmationOutcome(data.confirmationOutcome);
      rereadLaneOnMint(outcome, () => refreshVenueDrops(venueId));
      setDropMsg({
        ok: true,
        text: dropReceiptText(addedToNight, outcome, submittedPrice),
        links,
      });
    } catch {
      markFailed("Network or storage error. Try again.");
    }
  }

  async function reportDrop(venueId: string, id: string) {
    if (reportsInFlight.current.has(id)) return;
    reportsInFlight.current.add(id);
    const reportedDrop = dropsByVenueId.get(venueId)?.find((drop) => drop.id === id);
    // Optimistic remove — moderation is minimal, no reason UI.
    setDropsByVenueId((current) => {
      const next = new Map(current);
      next.set(venueId, (next.get(venueId) ?? []).filter((drop) => drop.id !== id));
      return next;
    });
    try {
      // `actor` is the device's stable anon id (same attribution reactions and
      // comments use) — the server hashes it into the per-actor report key, so
      // devices behind a shared IP (pub wifi / NAT) stay distinct actors.
      // Called from an event handler, so `window` exists; getAnonId() returns
      // "" when storage is unavailable and the server degrades to its shared
      // anon sentinel.
      const res = await authedActionFetch("/api/pint-drops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "report", id, actor: getAnonId() }),
      }, { requiresIdentity: true });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        if (reportedDrop) {
          setDropsByVenueId((current) => {
            const next = new Map(current);
            next.set(venueId, [
              reportedDrop,
              ...(next.get(venueId) ?? []).filter((drop) => drop.id !== id),
            ]);
            return next;
          });
        }
        reportsInFlight.current.delete(id);
        setDropMsg({
          ok: false,
          text:
            offlineOrMessage(errorMessageFrom(body, "Could not report that Pint Drop. Try again."))
        });
        return;
      }
      setDropMsg({ ok: true, text: "Report received. That Pint Drop is hidden." });
    } catch {
      if (reportedDrop) {
        setDropsByVenueId((current) => {
          const next = new Map(current);
          next.set(venueId, [
            reportedDrop,
            ...(next.get(venueId) ?? []).filter((drop) => drop.id !== id),
          ]);
          return next;
        });
      }
      reportsInFlight.current.delete(id);
      setDropMsg({
        ok: false,
        text:
          offlineOrMessage("Could not report that Pint Drop. Try again.")
      });
    }
  }

  // Reset composer chrome when the inspected venue changes.
  const closeComposer = useCallback(() => {
    setDropMsg(null);
    setComposerOpen(false);
    setConfirmSeed(null);
  }, []);

  const mapDropsByVenueId = useMemo(
    () =>
      mapVenues
        ? filterMapPintDropEntries(mapVenues, dropsByVenueId)
        : dropsByVenueId,
    [dropsByVenueId, mapVenues],
  );

  const venueSignals = useMemo(() => {
    const signals = new Map<
      string,
      {
        hasPintDrops: boolean;
        dropCount: number;
        /** THE trust state of the drop lane (lib/pintTrust.ts), read once. */
        pintTrust: PintTrustState;
        latestContributorPrice: number | null;
        /**
         * Epoch ms that contributor price was logged, or null. Carried so a
         * freshest-wins merge (community price submissions) can tell which
         * observation is actually newer instead of guessing.
         */
        latestContributorAt: number | null;
        /** Display-only demo price for pin colour when the slim index has null cheapestPrice. */
        latestDemoPrice: number | null;
        /** The venue's live confirmation as priceStandingFor takes it, or null. */
        confirmedPrice: ConfirmedPriceInput | null;
        /** An in-window report that has NOT earned the map, for the sheet alone. */
        provisionalContributorPrice: number | null;
        /** Epoch ms that provisional report was logged, or null. */
        provisionalContributorAt: number | null;
        /** A public report PAST the window, for the sheet's price area alone. */
        agedContributorPrice: number | null;
        /** Epoch ms that aged report was logged, or null. */
        agedContributorAt: number | null;
        /** The figures this pub's drinkers disagree about, for the sheet and
         *  the peek. Never a band, a bucket or a pin figure: two prices have
         *  no one number (lib/pintDropAgreement.ts). */
        disputedPrices: PintPriceSplit | null;
        /** Epoch ms the freshest of those was logged, or null. */
        disputedAt: number | null;
      }
    >();
    for (const [venueId, venueDrops] of mapDropsByVenueId) {
      // ONE READING of the drop lane (lib/pintTrust.ts), projected into every
      // drop-lane field of the signal. What has earned the map, what is one
      // report short, what is past the window and whether the server minted a
      // confirmation are four answers to one question, and they used to be
      // asked here as four separate calls. The order inside that reading is
      // the point: the minted confirmation comes first because the browser is
      // not shown an anonymous drop's authority key (#1440), so the client
      // re-derivation alone left the pin greyer than the venue sheet.
      //
      // Demo seeds never feed any of it. A lone organic drop feeds the
      // provisional fields only: AGENTS.md pin law, "an uncorroborated report
      // cannot reach either lane" (band or printed figure).
      const trust = pintTrustSignalFields(pintTrustFor(venueDrops));
      // Pin colour fallback only: when a city pack has null cheapestPrice,
      // a demo seed can still tint the pin. Never merges into venue.cheapestPrice.
      const latestDemoPrice =
        venueDrops.find(
          (drop) => drop.provenance === "demo" && typeof drop.priceGbp === "number",
        )?.priceGbp ?? null;
      // dropCount/hasPintDrops match the map halo: any visible drop counts
      // (seeds included) so the "has drops" signal is consistent everywhere.
      signals.set(venueId, {
        hasPintDrops: venueDrops.length > 0,
        dropCount: venueDrops.length,
        latestDemoPrice,
        ...trust,
      });
    }
    return signals;
  }, [mapDropsByVenueId]);

  return {
    dropsByVenueId: mapDropsByVenueId,
    venueDropStatus,
    venueSignals,
    refreshVenueDrops,
    refreshAllDrops,
    handle,
    setHandle,
    accountHandle,
    authConfigured,
    signedIn,
    identityReady,
    composerOpen,
    setComposerOpen,
    closeComposer,
    priceSeed: priceSeed ?? confirmSeed,
    seedComposerPrice,
    dropForm,
    setDropForm,
    vibeTags,
    setVibeTags,
    toggleVibeTag,
    visibility,
    setVisibility,
    pintPhoto,
    venuePhoto,
    receiptPhoto,
    pintInputRef,
    venueInputRef,
    receiptInputRef,
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
