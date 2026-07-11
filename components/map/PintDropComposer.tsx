"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  ImagePlus,
  Mic,
  MicOff,
  Minus,
  Plus,
  RefreshCw,
  Send,
  SmilePlus,
  X,
} from "lucide-react";

import { readActiveRoundCode, subscribeActiveRound } from "@/lib/activeRound";
import { VIBE_TAGS } from "@/lib/pintDropShared";
import {
  QUICK_ADD_PRICES_GBP,
  VISIBILITIES,
  formatPriceGbp,
  stepPrice,
  type Visibility,
} from "@/lib/spill";
import {
  SPILL_DESTINATIONS,
  DESTINATION_META,
  buildSpillPreview,
  mergePriceChips,
  resolveDestination,
  type SpillDestination,
} from "@/lib/spillPreview";
import { readPintDropDraft, writePintDropDraft } from "@/lib/pintDropDraft";
import { markPubmaxTiming } from "@/lib/performanceMarks";
import type { LastPintDecision } from "@/lib/tfl";
import type { PintDropsState } from "@/components/map/usePintDrops";
import "./spillComposer.css";

type PintDropComposerProps = {
  venueId: string;
  state: PintDropsState;
  /** Optional pub name for the preview card scrim; the composer degrades
   *  gracefully to a generic label when the seam doesn't pass one. */
  venueName?: string;
  /** Live Last Pint decision from the Getting-home tab (Wave G1). When a
   *  genuine live kind + leave-by exist, submit stamps them on the Spill. */
  lastTrainDecision?: LastPintDecision | null;
};

// Honest, one-line copy per visibility lane (issue #24 / PRD "The Spill").
// Order matches VISIBILITIES so the segmented control and the allowlist never
// drift apart.
const VISIBILITY_COPY: Record<Visibility, { label: string; helper: string }> = {
  public: { label: "Public", helper: "Everyone — the feed, map, and Ledger." },
  friends: { label: "Friends", helper: "People who follow you." },
  legacy: { label: "Legacy", helper: "Kept for the pub's Ledger, off the feed." },
  anonymous: { label: "Anonymous", helper: "Posted as a PUBMAXXER — your handle is hidden." },
};

const GENERATION_PRESETS = [
  { label: "Tonight", value: "Tonight" },
  { label: "Old memory", value: "Old memory" },
  { label: "Family story", value: "Family story" },
] as const;

// Minimal, feature-detected typings for the Web Speech API — not in lib.dom.d.ts.
type SpeechRecognitionResultLike = { 0: { transcript: string }; isFinal: boolean };
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function PintDropComposer({
  venueId,
  state,
  venueName,
  lastTrainDecision = null,
}: PintDropComposerProps) {
  const {
    handle,
    setHandle,
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
    venueSignals,
  } = state;

  const maxTagsReached = vibeTags.length >= 4;
  const handleId = useId();
  const priceInputId = useId();
  const drinkInputId = useId();
  const noteInputId = useId();
  const withWhoInputId = useId();
  const eraInputId = useId();
  const [draftReadyVenueId, setDraftReadyVenueId] = useState<string | null>(null);
  useEffect(() => {
    markPubmaxTiming("pubmax:composer-mounted");
  }, []);
  if (draftReadyVenueId !== null && draftReadyVenueId !== venueId) {
    // React adjust-state-during-render pattern: block stale shared composer
    // state from painting under a newly selected pub while the venue draft
    // hydrates. The actual field reset happens in the effect below.
    setDraftReadyVenueId(null);
  }
  const draftReady = draftReadyVenueId === venueId;

  useEffect(() => {
    let active = true;
    async function hydrateVenueDraft() {
      const draft = readPintDropDraft(
        typeof window === "undefined" ? null : window.sessionStorage,
        venueId,
      );
      if (!active) return;
      resetComposer();
      if (draft) {
        setDropForm(draft.form);
        setVisibility(draft.visibility);
        setVibeTags(draft.vibeTags);
      }
      setDraftReadyVenueId(venueId);
    }
    void hydrateVenueDraft();
    return () => {
      active = false;
    };
  }, [venueId, resetComposer, setDropForm, setVisibility, setVibeTags]);

  useEffect(() => {
    if (draftReadyVenueId !== venueId) return;
    writePintDropDraft(
      typeof window === "undefined" ? null : window.sessionStorage,
      venueId,
      {
        form: dropForm,
        visibility,
        vibeTags,
        updatedAt: new Date().toISOString(),
      },
    );
  }, [venueId, draftReadyVenueId, dropForm, visibility, vibeTags]);

  // Camera-first, not camera-blocked: on mobile the photo action is presented
  // first, while price/story controls stay available on the first usable paint.
  // Desktop keeps the old single-scroll layout. Hydration-safe: server render
  // and first client paint agree on `mobile=false`, then matchMedia upgrades.
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setMobile(mq.matches);
    apply();
    // addEventListener("change") is the modern API; the older addListener is a
    // fallback for Safari < 14. Either way we clean up on unmount.
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);

  // Voice-to-text (issue #24): feature-detected, hidden entirely when the
  // browser has no Web Speech API. Degrades silently to typing on error.
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const noteBeforeListeningRef = useRef("");

  // Active-Round detection for the "My Round" destination chip.
  // Read once after hydration; never blocks the composer.
  const [hasActiveRound, setHasActiveRound] = useState(false);

  useEffect(() => {
    // Async wrapper so the setState lands in a microtask after hydration —
    // the server render (no window) and first client paint agree, then the
    // mic button appears. Mirrors the feed page's handle-read idiom.
    let active = true;
    async function detectSpeech() {
      const supported = getSpeechRecognitionCtor() !== null;
      if (active) setSpeechSupported(supported);
    }
    void detectSpeech();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Async wrapper defers the setState to a microtask after hydration (same
    // idiom as detectSpeech above), so the server render and first client paint
    // agree on "no active Round" and the repo's set-state-in-effect rule is met.
    // subscribeActiveRound covers same-tab writes, cross-tab storage, and focus.
    let active = true;
    async function detectRound() {
      if (active) setHasActiveRound(Boolean(readActiveRoundCode()));
    }
    void detectRound();
    const unsubscribe = subscribeActiveRound(() => {
      if (active) setHasActiveRound(Boolean(readActiveRoundCode()));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Stop any in-flight recognition on unmount (venue switch/composer close).
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  function startListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return; // Feature-detected away — button isn't rendered anyway.
    try {
      const recognition = new Ctor();
      recognition.lang = "en-GB";
      recognition.interimResults = true;
      recognition.continuous = true;
      noteBeforeListeningRef.current = dropForm.note;
      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          transcript += event.results[i]["0"].transcript;
        }
        const base = noteBeforeListeningRef.current;
        const joined = base.trim() ? `${base.trim()} ${transcript}` : transcript;
        setDropForm((current) => ({ ...current, note: joined }));
      };
      recognition.onerror = () => {
        // Silent degrade to typing — no error surfaced, per spec.
        setListening(false);
      };
      recognition.onend = () => {
        setListening(false);
      };
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function toggleListening() {
    if (listening) stopListening();
    else startListening();
  }

  // Price quick-adds: the venue's last-known contributor price leads (fastest
  // one-tap on the pub's real recent price), de-duped against the common points.
  const lastKnownPrice = venueSignals.get(venueId)?.latestContributorPrice ?? null;
  const priceQuickAdds = useMemo(
    () => mergePriceChips(QUICK_ADD_PRICES_GBP, lastKnownPrice),
    [lastKnownPrice],
  );

  // The currently-selected destination chip (derived from visibility so the
  // segmented visibility control and the chips can't disagree). When two chips
  // share a visibility (Family Table + Ledger both → legacy) we keep an explicit
  // selection so the writer's intent survives; a raw visibility change from the
  // segmented control clears the chip highlight.
  const [destination, setDestination] = useState<SpillDestination | null>(null);

  function chooseDestination(key: SpillDestination) {
    const resolved = resolveDestination(key, hasActiveRound);
    if (!resolved.enabled) return; // Disabled chip (e.g. My Round with no Round).
    setDestination(key);
    setVisibility(resolved.visibility);
  }

  // The live preview model — rebuilt on every keystroke, purely (lib/spillPreview).
  const preview = useMemo(
    () =>
      buildSpillPreview({
        handle,
        price: dropForm.price,
        note: dropForm.note,
        withWho: dropForm.withWho,
        drink: dropForm.drink,
        era: dropForm.era,
        visibility,
        venueName: venueName ?? "this pub",
        hasPhoto: Boolean(pintPhoto),
      }),
    [
      handle,
      dropForm.price,
      dropForm.note,
      dropForm.withWho,
      dropForm.drink,
      dropForm.era,
      visibility,
      venueName,
      pintPhoto,
    ],
  );

  // Mobile still leads with the photo affordance, but price/story controls must
  // be available on first paint so logging a pint never waits behind camera UI.
  const showRest = true;

  useEffect(() => {
    if (draftReady) markPubmaxTiming("pubmax:composer-interactive");
  }, [draftReady]);

  if (!draftReady) {
    return (
      <form
        className="dropComposer spillComposer"
        aria-busy="true"
        aria-label="Pint Drop composer"
      >
        <p className="description muted">Loading saved Pint Drop draft...</p>
      </form>
    );
  }

  return (
    <form
      className="dropComposer spillComposer"
      aria-label="Pint Drop composer"
      onSubmit={(event) => submitDrop(event, venueId, { venueName, lastTrainDecision })}
    >
      <div className="spillComposerIntro">
        <span className="spillComposerEyebrow">Drop a pint here</span>
        <strong>{venueName ?? "This pub"}</strong>
      </div>

      {/* ── Compact photo action (mobile) ─────────────────────────────────────
          On a phone the shot is immediately available, but the rest of the
          composer stays visible so a price/story drop is not blocked by camera
          setup. Desktop renders the classic inline photo pair lower down. */}
      {mobile ? (
        <div className="spillCameraStep" data-testid="spill-camera-step">
          <div className="spillCameraHeader">
            <span className="spillStepEyebrow">Start with the shot</span>
            <span className="spillCameraHint">9:16 Spill preview</span>
          </div>
          {pintPhoto ? (
            <div className="spillCaptureRail hasShot">
              <div className="spillCameraShot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pintPhoto.previewUrl}
                  alt="Preview of your pint photo"
                  decoding="async"
                />
                <span className="spillShotStamp">Shot ready</span>
              </div>
              <button
                type="button"
                className="photoRemove"
                onClick={() => removePhoto("pint")}
                aria-label="Remove pint photo"
              >
                <X size={13} /> Retake
              </button>
            </div>
          ) : (
            <div className="spillCaptureRail">
              <div className="spillCameraFrame" aria-hidden="true">
                <span className="spillCameraLens">
                  <Camera size={30} />
                </span>
                <span className="spillShotStamp">Rear camera first</span>
              </div>
              <div className="spillCameraActions">
              {/* Rear camera first — the pour is the hero. `capture="environment"`
                  opens the rear camera on mobile; on desktop it's a file pick. */}
                <label className="spillCameraBtn primary">
                  <Camera size={22} />
                  <span>Snap the pour</span>
                  <input
                    ref={pintInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    aria-label="Snap the pour: snap or upload a pint photo"
                    onChange={(event) =>
                      pickPhoto("pint", event.target.files?.[0], event.target)
                    }
                  />
                </label>
              {/* Flip to the front camera for a bar selfie. Stored in the venue
                  slot so provenance/photo semantics are unchanged. */}
                <label className="spillCameraBtn">
                  <SmilePlus size={18} />
                  <span>Flip — you at the bar</span>
                  <input
                    ref={venueInputRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    aria-label="Flip — you at the bar: snap or upload a selfie"
                    onChange={(event) =>
                      pickPhoto("venue", event.target.files?.[0], event.target)
                    }
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* The rest of the composer. On mobile this is visible immediately under
          the compact photo affordance so Drop never feels blocked by camera UI. */}
      {showRest ? (
        <>
          <label className="spillTextField" htmlFor={handleId}>
            <span className="spillFieldLabel">Handle</span>
            <input
              id={handleId}
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="@thirsty_ted"
              required
            />
          </label>

          {/* ── One-tap destinations (PRD priority 2) ──────────────────────────
              Shortcuts onto EXISTING visibility semantics. My Round is disabled
              (never faked) unless a Round is actually open. */}
          <fieldset className="destinationField">
            <legend>Add to</legend>
            <div className="destinationRow" role="group" aria-label="Add this Spill to">
              {SPILL_DESTINATIONS.map((key) => {
                const meta = DESTINATION_META[key];
                const resolved = resolveDestination(key, hasActiveRound);
                const selected = destination === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={selected ? "destinationChip selected" : "destinationChip"}
                    aria-pressed={selected}
                    disabled={!resolved.enabled}
                    title={resolved.helper}
                    onClick={() => chooseDestination(key)}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
            {destination ? (
              <p className="destinationHelper">
                {resolveDestination(destination, hasActiveRound).helper}
              </p>
            ) : null}
          </fieldset>

          <div className="priceField">
            <label className="priceFieldLabel" htmlFor={priceInputId}>
              What did it cost?
            </label>
            <div className="priceStepper">
              <button
                type="button"
                className="priceStepBtn"
                aria-label="Decrease price by 10 pence"
                onClick={() => setDropForm({ ...dropForm, price: stepPrice(dropForm.price, -1) })}
              >
                <Minus size={15} />
              </button>
              <input
                id={priceInputId}
                value={dropForm.price}
                onChange={(event) => setDropForm({ ...dropForm, price: event.target.value })}
                placeholder="£"
                inputMode="decimal"
              />
              <button
                type="button"
                className="priceStepBtn"
                aria-label="Increase price by 10 pence"
                onClick={() => setDropForm({ ...dropForm, price: stepPrice(dropForm.price, 1) })}
              >
                <Plus size={15} />
              </button>
            </div>
            <div className="priceQuickAdds" role="group" aria-label="Quick-add price">
              {priceQuickAdds.map((price) => {
                const label = formatPriceGbp(price);
                const selected = dropForm.price === label;
                const isLastKnown =
                  typeof lastKnownPrice === "number" && formatPriceGbp(lastKnownPrice) === label;
                return (
                  <button
                    key={price}
                    type="button"
                    className={selected ? "priceChip stampChip selected" : "priceChip stampChip"}
                    onClick={() => setDropForm({ ...dropForm, price: label })}
                    title={isLastKnown ? "This pub's last logged price" : undefined}
                    aria-pressed={selected}
                  >
                    £{label}
                    {isLastKnown ? <span className="priceChipTag">last</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="spillTextField" htmlFor={drinkInputId}>
            <span className="spillFieldLabel">Drink</span>
            <input
              id={drinkInputId}
              value={dropForm.drink}
              onChange={(event) => setDropForm({ ...dropForm, drink: event.target.value })}
              placeholder="Pint, half, soda, guest ale"
            />
          </label>

          <div className="noteField">
            <div className="spillFieldHeader">
              <label className="spillFieldLabel" htmlFor={noteInputId}>
                Story
              </label>
              <span className="voiceAffordance">Type or talk it in</span>
            </div>
            <div className="noteFieldRow">
              <textarea
                id={noteInputId}
                value={dropForm.note}
                onChange={(event) => setDropForm({ ...dropForm, note: event.target.value })}
                placeholder="What happened?"
              />
              {speechSupported ? (
                <button
                  type="button"
                  className={listening ? "micBtn listening" : "micBtn"}
                  aria-pressed={listening}
                  aria-label={listening ? "Stop voice note" : "Add note by voice"}
                  onClick={toggleListening}
                >
                  {listening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
              ) : null}
            </div>
            {speechSupported ? (
              <span role="status" className="visuallyHidden">
                {listening ? "Listening…" : ""}
              </span>
            ) : null}
          </div>

          <label className="spillTextField" htmlFor={withWhoInputId}>
            <span className="spillFieldLabel">With</span>
            <input
              id={withWhoInputId}
              value={dropForm.withWho}
              onChange={(event) => setDropForm({ ...dropForm, withWho: event.target.value })}
              placeholder="@sam, @priya, or names"
            />
          </label>

          <fieldset className="generationField">
            <legend>When is this from?</legend>
            <div className="generationRow" role="group" aria-label="Generation mode">
              {GENERATION_PRESETS.map((preset) => {
                const selected = dropForm.era === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    className={selected ? "generationChip selected" : "generationChip"}
                    aria-pressed={selected}
                    onClick={() => setDropForm({ ...dropForm, era: preset.value })}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <label className="visuallyHidden" htmlFor={eraInputId}>
              Custom generation or memory label
            </label>
            <input
              id={eraInputId}
              value={dropForm.era}
              onChange={(event) => setDropForm({ ...dropForm, era: event.target.value })}
              placeholder="Or write your own: 1998, first date, dad's local"
            />
          </fieldset>

          <fieldset className="vibeTagField">
            <legend>The vibe</legend>
            <div className="vibeTagRow" role="group" aria-label="Vibe tags — choose up to 4">
              {VIBE_TAGS.map((tag) => {
                const selected = vibeTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={selected ? "vibeChip selected" : "vibeChip"}
                    aria-pressed={selected}
                    disabled={!selected && maxTagsReached}
                    onClick={() => toggleVibeTag(tag)}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Visibility is now SECONDARY (PRD priority 2): the one-tap
              destinations above are the primary lane pick; this segmented control
              stays for fine-grained control and keeps the accessible radiogroup. */}
          <fieldset className="visibilityField">
            <legend>Who sees this</legend>
            <div className="visibilitySegment" role="radiogroup" aria-label="Visibility">
              {VISIBILITIES.map((option) => {
                const selected = visibility === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={selected ? "visibilityOption selected" : "visibilityOption"}
                    onClick={() => {
                      setVisibility(option);
                      setDestination(null); // A manual lane pick clears the chip.
                    }}
                  >
                    {VISIBILITY_COPY[option].label}
                  </button>
                );
              })}
            </div>
            <p className="visibilityHelper">{VISIBILITY_COPY[visibility].helper}</p>
          </fieldset>

          {/* Desktop photo pair — the classic inline slots. Skipped on mobile,
              where the camera-first step above already owns the photo. */}
          {!mobile ? (
            <div className="photoRow instaPintRow spillDesktopCapture">
              <div className="spillCaptureIntro">
                <span className="spillFieldLabel">Capture</span>
                <span>Shot first, story second</span>
              </div>
              <div className="photoField">
                {pintPhoto ? (
                  <div className="photoPreview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pintPhoto.previewUrl}
                      alt="Preview of your pint photo"
                      width={120}
                      height={120}
                      decoding="async"
                    />
                    <button
                      type="button"
                      className="photoRemove"
                      onClick={() => removePhoto("pint")}
                      aria-label="Remove pint photo"
                    >
                      <X size={13} /> Remove
                    </button>
                  </div>
                ) : (
                  <label className="photoPick">
                    <ImagePlus size={18} />
                    <span>Your pint</span>
                    <small>Snap or upload</small>
                    <input
                      ref={pintInputRef}
                      type="file"
                      accept="image/*"
                      aria-label="Your pint: Snap or upload"
                      onChange={(event) =>
                        pickPhoto("pint", event.target.files?.[0], event.target)
                      }
                    />
                  </label>
                )}
              </div>
              <div className="photoField">
                {venuePhoto ? (
                  <div className="photoPreview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={venuePhoto.previewUrl}
                      alt="Preview of your cheeky selfie at the bar"
                      width={120}
                      height={120}
                      decoding="async"
                    />
                    <button
                      type="button"
                      className="photoRemove"
                      onClick={() => removePhoto("venue")}
                      aria-label="Remove selfie"
                    >
                      <X size={13} /> Remove
                    </button>
                  </div>
                ) : (
                  <label className="photoPick">
                    <SmilePlus size={18} />
                    <span>You at the bar</span>
                    <small>Cheeky selfie</small>
                    <input
                      ref={venueInputRef}
                      type="file"
                      accept="image/*"
                      aria-label="You at the bar: Cheeky selfie"
                      onChange={(event) =>
                        pickPhoto("venue", event.target.files?.[0], event.target)
                      }
                    />
                  </label>
                )}
              </div>
            </div>
          ) : null}

          {/* ── Instant preview card (PRD priority 2) ──────────────────────────
              A live, client-only render styled like the final 9:16 feedSpill card
              — photo (or a candle-lit placeholder), price stamp, provenance
              badge, and the handle scrim. Provenance is derived exactly as the
              server derives it, never flattened. */}
          <div className="spillPreviewWrap" aria-hidden="true">
            <span className="spillPreviewEyebrow">Live preview</span>
            <div className={`spillPreviewCard${preview.hasPhoto ? " hasPhoto" : ""}`}>
              {preview.hasPhoto && pintPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="spillPreviewPhoto"
                  src={pintPhoto.previewUrl}
                  alt=""
                  decoding="async"
                />
              ) : (
                <div className="spillPreviewPlaceholder">
                  <Camera size={26} />
                  <span>Your shot lands here</span>
                </div>
              )}
              <div className="spillPreviewStamps">
                <span className={`spillPreviewProv feedProv-${preview.provenance}`}>
                  {preview.provenanceLabel}
                </span>
                <span className="spillPreviewVisibility">{VISIBILITY_COPY[visibility].label}</span>
              </div>
              {preview.priceLabel ? (
                <span className="spillPreviewPrice">{preview.priceLabel}</span>
              ) : null}
              <div className="spillPreviewScrim">
                <div className="spillPreviewWho">
                  <span className="spillPreviewAvatar">{preview.initial}</span>
                  <div className="spillPreviewWhoText">
                    <span className="spillPreviewHandle">{preview.shownHandle}</span>
                    <span className="spillPreviewMeta">{preview.venueName}</span>
                  </div>
                </div>
                {preview.note ? <p className="spillPreviewNote">{preview.note}</p> : null}
              </div>
            </div>
          </div>

          <p className="consentNote">
            Photos and notes are public and may show people. Only upload what you&rsquo;re happy to
            share.
          </p>

          <div className="composerActions">
            <button type="submit" disabled={submitting}>
              <Send size={14} /> {submitting ? "Posting…" : "Post Pint Drop"}
            </button>
            {mobile && (pintPhoto || venuePhoto) ? (
              <button
                type="button"
                className="spillRetakeBtn"
                onClick={() => {
                  if (pintPhoto) removePhoto("pint");
                  if (venuePhoto) removePhoto("venue");
                }}
              >
                <RefreshCw size={13} /> New shot
              </button>
            ) : null}
            {dropMsg ? (
              <span
                role={dropMsg.ok ? "status" : "alert"}
                className={`composerMsg ${dropMsg.ok ? "ok" : "error"}`}
              >
                {dropMsg.text}
                {dropMsg.ok && dropMsg.links && dropMsg.links.length > 0 ? (
                  <span className="composerMsgLinks">
                    {dropMsg.links.map((link) => (
                      <Link key={link.href} href={link.href} className="composerMsgLink">
                        {link.label}
                      </Link>
                    ))}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </form>
  );
}
