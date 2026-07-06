"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Mic, MicOff, Minus, Plus, Send, SmilePlus, X } from "lucide-react";

import { VIBE_TAGS } from "@/lib/pintDrops";
import {
  QUICK_ADD_PRICES_GBP,
  VISIBILITIES,
  formatPriceGbp,
  stepPrice,
  type Visibility,
} from "@/lib/spill";
import type { PintDropsState } from "@/components/map/usePintDrops";
import "./spillComposer.css";

type PintDropComposerProps = {
  venueId: string;
  state: PintDropsState;
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

export default function PintDropComposer({ venueId, state }: PintDropComposerProps) {
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
  } = state;

  const maxTagsReached = vibeTags.length >= 4;

  // Voice-to-text (issue #24): feature-detected, hidden entirely when the
  // browser has no Web Speech API. Degrades silently to typing on error.
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const noteBeforeListeningRef = useRef("");

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

  const priceQuickAdds = useMemo(() => QUICK_ADD_PRICES_GBP, []);

  return (
    <form className="dropComposer" onSubmit={(event) => submitDrop(event, venueId)}>
      <input
        value={handle}
        onChange={(event) => setHandle(event.target.value)}
        placeholder="Your handle (e.g. @thirsty_ted)"
        aria-label="Contributor handle"
        required
      />

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
                onClick={() => setVisibility(option)}
              >
                {VISIBILITY_COPY[option].label}
              </button>
            );
          })}
        </div>
        <p className="visibilityHelper">{VISIBILITY_COPY[visibility].helper}</p>
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
            return (
              <button
                key={price}
                type="button"
                className={selected ? "priceChip selected" : "priceChip"}
                onClick={() => setDropForm({ ...dropForm, price: label })}
              >
                £{label}
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
              <Camera size={18} />
              <span>Your pint</span>
              <small>Snap the pour</small>
              {/* `capture="environment"` opens the rear camera on mobile so the
                  pint slot is camera-first; desktop falls back to a file pick. */}
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
              {/* `capture="user"` opens the front (selfie) camera on mobile for
                  the "you at the bar" slot; desktop falls back to a file pick. */}
              <input
                ref={venueInputRef}
                type="file"
                accept="image/*"
                capture="user"
                onChange={(event) =>
                  pickPhoto("venue", event.target.files?.[0], event.target)
                }
              />
            </label>
          )}
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
        {dropMsg ? (
          <span
            role={dropMsg.ok ? "status" : "alert"}
            className={`composerMsg ${dropMsg.ok ? "ok" : "error"}`}
          >
            {dropMsg.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
