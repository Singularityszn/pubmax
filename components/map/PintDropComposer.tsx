"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import type { PintDropsState } from "@/components/map/usePintDrops";
import "./spillComposer.css";

type PintDropComposerProps = {
  venueId: string;
  state: PintDropsState;
  /** Optional pub name for the preview card scrim; the composer degrades
   *  gracefully to a generic label when the seam doesn't pass one. */
  venueName?: string;
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

// The optional client seam for "is a Round open right now?". No client-side
// active-Round state ships yet (rounds are URL-bound + server-centric), so we
// read a forward-compatible localStorage key: whoever wires Rounds into the
// composer later can set `pubmax_active_round` and the "My Round" chip lights up
// with zero further changes here. Absent → the chip is honestly disabled.
const ACTIVE_ROUND_KEY = "pubmax_active_round";

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

export default function PintDropComposer({ venueId, state, venueName }: PintDropComposerProps) {
  const {
    handle,
    setHandle,
    dropForm,
    setDropForm,
    vibeTags,
    toggleVibeTag,
    visibility,
    setVisibility,
    pintPhoto,
    venuePhoto,
    pintInputRef,
    venueInputRef,
    pickPhoto,
    removePhoto,
    submitting,
    dropMsg,
    submitDrop,
    venueSignals,
  } = state;

  const maxTagsReached = vibeTags.length >= 4;

  // Camera-first (PRD priority 2): on a mobile-class viewport the photo/camera
  // step is presented FIRST as a full step; the writer either shoots (or picks)
  // a photo or explicitly skips it, and only then are text/price/voice revealed.
  // Desktop keeps the old single-scroll layout (no fake camera; the photo slots
  // sit inline lower down as they always did). Hydration-safe: server render and
  // first client paint agree on `mobile=false`, then matchMedia upgrades — the
  // same idiom the speech detection below uses.
  const [mobile, setMobile] = useState(false);
  const [photoStepDone, setPhotoStepDone] = useState(false);

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

  // Active-Round detection for the "My Round" destination chip (see
  // ACTIVE_ROUND_KEY). Read once after hydration; never blocks the composer.
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
    let active = true;
    async function detectRound() {
      let open = false;
      try {
        open = Boolean(window.localStorage.getItem(ACTIVE_ROUND_KEY));
      } catch {
        // Private-mode / disabled storage — treat as no active Round.
        open = false;
      }
      if (active) setHasActiveRound(open);
    }
    if (typeof window !== "undefined") void detectRound();
    return () => {
      active = false;
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

  const hasAnyPhoto = Boolean(pintPhoto || venuePhoto);
  // On mobile the rest of the form is gated behind the camera-first step until
  // the writer shoots a photo or taps "skip". On desktop everything is shown.
  const showRest = !mobile || photoStepDone || hasAnyPhoto;

  return (
    <form className="dropComposer spillComposer" onSubmit={(event) => submitDrop(event, venueId)}>
      {/* ── Camera-first step (mobile) ────────────────────────────────────────
          On a phone the very first thing the composer presents is the shot: a
          rear-camera capture, a flip to the front camera, or an explicit skip.
          Desktop renders the classic inline photo pair lower down instead. */}
      {mobile ? (
        <div className="spillCameraStep" data-testid="spill-camera-step">
          <span className="spillStepEyebrow">Start with the shot</span>
          {pintPhoto ? (
            <div className="spillCameraShot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pintPhoto.previewUrl}
                alt="Preview of your pint photo"
                decoding="async"
              />
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
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={(event) =>
                    pickPhoto("venue", event.target.files?.[0], event.target)
                  }
                />
              </label>
            </div>
          )}
          {!showRest ? (
            <button
              type="button"
              className="spillSkipPhoto"
              onClick={() => setPhotoStepDone(true)}
            >
              Skip photo — just the price &amp; story
            </button>
          ) : null}
        </div>
      ) : null}

      {/* The rest of the composer. Hidden on mobile until the camera step is
          resolved (shot taken or skipped); always shown on desktop. */}
      {showRest ? (
        <>
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="Your handle (e.g. @thirsty_ted)"
            aria-label="Contributor handle"
            required
          />

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
            <span className="priceFieldLabel">What did it cost?</span>
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
                value={dropForm.price}
                onChange={(event) => setDropForm({ ...dropForm, price: event.target.value })}
                placeholder="£"
                inputMode="decimal"
                aria-label="What did the pint cost, in pounds"
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
                    className={selected ? "priceChip selected" : "priceChip"}
                    onClick={() => setDropForm({ ...dropForm, price: label })}
                    title={isLastKnown ? "This pub's last logged price" : undefined}
                  >
                    £{label}
                    {isLastKnown ? <span className="priceChipTag">last</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <input
            value={dropForm.drink}
            onChange={(event) => setDropForm({ ...dropForm, drink: event.target.value })}
            placeholder="Drink"
            aria-label="Drink name"
          />

          <div className="noteField">
            <div className="noteFieldRow">
              <textarea
                value={dropForm.note}
                onChange={(event) => setDropForm({ ...dropForm, note: event.target.value })}
                placeholder="What happened?"
                aria-label="What happened"
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

          <input
            value={dropForm.withWho}
            onChange={(event) => setDropForm({ ...dropForm, withWho: event.target.value })}
            placeholder="Who were you with? (e.g. @sam, @priya, or names)"
            aria-label="Who were you with"
          />

          <input
            value={dropForm.era}
            onChange={(event) => setDropForm({ ...dropForm, era: event.target.value })}
            placeholder="An old memory, or tonight?"
            aria-label="An old memory, or tonight"
          />

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
            <div className="photoRow instaPintRow">
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
              <span className={`spillPreviewProv feedProv-${preview.provenance}`}>
                {preview.provenanceLabel}
              </span>
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
                  setPhotoStepDone(false);
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
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </form>
  );
}
